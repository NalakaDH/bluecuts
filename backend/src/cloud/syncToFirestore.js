const { getFirestore } = require('./firestoreAdmin');

function ymdNowUtc() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Builds and writes Firestore documents used by the cloud dashboard UI.
 *
 * This is intentionally "one way": SQLite remains source of truth.
 * Cloud docs are denormalized snapshots meant for read-only UI.
 *
 * @param {object} deps
 * @param {(sql:string, params?:any[])=>Promise<any[]>} deps.dbAll
 * @param {(sql:string, params?:any[])=>Promise<any>} deps.dbGet
 * @param {function} deps.loadExchangeRatesThbPerUnit
 * @param {function} deps.businessTodayYmd
 * @param {function} deps.businessZonedDayBoundsUtc
 * @param {function} deps.businessYmdAddCalendarDays
 * @param {function} deps.sqliteUtcFromMs
 * @param {string} deps.BUSINESS_TZ
 * @param {object} deps.sqlPieces (prebuilt SQL snippets from server.js)
 */
async function syncToFirestore(deps, opts) {
  const {
    dbAll,
    dbGet,
    loadExchangeRatesThbPerUnit,
    buildInventoryMonthlyReport,
    businessTodayYmd,
    businessZonedDayBoundsUtc,
    businessYmdAddCalendarDays,
    sqliteUtcFromMs,
    BUSINESS_TZ,
    sqlPieces,
  } = deps;

  const {
    shopId,
    reportsTop = 5,
    reportsRangeDays = 30,
    dashboardDays = 366,
    monthlyYear,
    monthlyMonth,
  } = opts || {};

  if (!shopId || !String(shopId).trim()) {
    throw new Error('Missing shopId');
  }

  const fs = getFirestore();
  const shopRef = fs.collection('shops').doc(String(shopId).trim());

  const nowIso = new Date().toISOString();

  // ----- Exchange rates (for USD bridge calculations in UI) -----
  const thb_per_unit = await loadExchangeRatesThbPerUnit();
  const ratesDoc = {
    base: 'USD',
    thb_per_unit,
    syncedAt: nowIso,
  };

  // ----- Check Inventory snapshot -----
  const invSql = `
    SELECT
      id, category, item_type,
      pieces, pieces_remaining,
      weight_grams, weight_carats,
      purchasing_total_price, purchasing_carat_price,
      selling_total_price, selling_carat_price,
      IFNULL(selling_currency, 'THB') AS selling_currency,
      image_path,
      item_sticker, item_code,
      description,
      status,
      created_at, updated_at
    FROM inventory_items
    ORDER BY updated_at DESC
  `;
  const invRows = await dbAll(invSql, []);

  const activitySql = `
    SELECT
      i.id AS id,
      COALESCE(
        (SELECT SUM(ABS(sm.qty_change)) FROM stock_movements sm
         WHERE sm.inventory_item_id = i.id AND sm.type = 'SHRINKAGE'),
        0
      ) AS shrink_units,
      COALESCE(
        -(SELECT SUM(sm_m.qty_change) FROM stock_movements sm_m
          WHERE sm_m.inventory_item_id = i.id AND sm_m.type IN ('MEMO_OUT', 'MEMO_RETURN', 'MEMO_VOID')),
        0
      ) AS memo_units,
      COALESCE(
        -(SELECT SUM(sm_s.qty_change) FROM stock_movements sm_s
          WHERE sm_s.inventory_item_id = i.id AND sm_s.type IN ('SALE', 'INVOICE_RETURN')),
        0
      ) AS sold_units,
      (SELECT MAX(sm2.created_at) FROM stock_movements sm2 WHERE sm2.inventory_item_id = i.id) AS last_activity,
      EXISTS(
        SELECT 1 FROM stock_movements sm3
        WHERE sm3.inventory_item_id = i.id AND sm3.type = 'INVENTORY_EDIT' LIMIT 1
      ) AS has_manual_edit
    FROM inventory_items i
  `;
  const activityRows = await dbAll(activitySql, []);
  const activityMap = {};
  for (const r of activityRows || []) {
    activityMap[String(r.id)] = {
      shrink_units: Number(r.shrink_units) || 0,
      memo_units: Math.max(0, Math.round(Number(r.memo_units) || 0)),
      sold_units: Math.max(0, Math.round(Number(r.sold_units) || 0)),
      last_activity: r.last_activity || null,
      has_manual_edit: Boolean(r.has_manual_edit),
    };
  }

  const checkInventoryDoc = {
    items: invRows || [],
    activity_summary: activityMap,
    syncedAt: nowIso,
  };

  // ----- Dashboard overview snapshot -----
  const businessToday = businessTodayYmd();
  const trendToYmd = businessToday;
  const trendFromYmd = businessYmdAddCalendarDays(businessToday, -(Math.max(2, Math.min(366, Number(dashboardDays) || 30)) - 1));
  const trendFromBounds = businessZonedDayBoundsUtc(trendFromYmd);
  const trendToBounds = businessZonedDayBoundsUtc(trendToYmd);
  const trendFromSql = sqliteUtcFromMs(trendFromBounds.startMs);
  const trendToSql = sqliteUtcFromMs(trendToBounds.endMs);

  const todayBounds = businessZonedDayBoundsUtc(businessToday);
  const todayStartSql = sqliteUtcFromMs(todayBounds.startMs);
  const todayEndSql = sqliteUtcFromMs(todayBounds.endMs);

  const {
    SQL_PAYMENTS_AGG_IP,
    SQL_INV_FX_JOIN,
    SQL_INV_OUTSTANDING_NATIVE,
    sqlInvThbTotalRow,
    sqlInvThbPaidRow,
    sqlInvThbOutstandingRow,
  } = sqlPieces;

  const paymentsAgg = SQL_PAYMENTS_AGG_IP;

  const todaySalesSql = `
    SELECT
      COUNT(i.id) AS invoices_count,
      IFNULL(SUM(${sqlInvThbTotalRow()}), 0) AS sales_total,
      IFNULL(SUM(${sqlInvThbPaidRow()}), 0) AS collected_total,
      IFNULL(SUM(${sqlInvThbOutstandingRow()}), 0) AS outstanding_total,
      SUM(CASE WHEN i.status = 'Paid' THEN 1 ELSE 0 END) AS paid_invoices,
      SUM(CASE WHEN i.status = 'Partial' THEN 1 ELSE 0 END) AS partial_invoices,
      SUM(CASE WHEN i.status = 'Unpaid' THEN 1 ELSE 0 END) AS unpaid_invoices
    FROM invoices i
    LEFT JOIN ${paymentsAgg} ON ip.invoice_id = i.id
    ${SQL_INV_FX_JOIN}
    WHERE i.created_at >= ? AND i.created_at < ?
  `;

  const itemsSoldTodaySql = `
    SELECT IFNULL(SUM(ii.quantity), 0) AS items_sold
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    WHERE i.created_at >= ? AND i.created_at < ?
  `;

  const outstandingAllSql = `
    SELECT
      IFNULL(SUM(${sqlInvThbOutstandingRow()}), 0) AS outstanding_total,
      COUNT(*) AS outstanding_invoice_count
    FROM invoices i
    LEFT JOIN ${paymentsAgg} ON ip.invoice_id = i.id
    ${SQL_INV_FX_JOIN}
    WHERE ${SQL_INV_OUTSTANDING_NATIVE} > 0.0001
  `;

  const openMemosSql = `SELECT COUNT(*) AS open_memos FROM memos m WHERE m.status != 'Closed'`;

  const memosDueSoonSql = `
    SELECT COUNT(*) AS due_soon
    FROM memos m
    WHERE m.status != 'Closed'
      AND m.due_date IS NOT NULL
      AND TRIM(m.due_date) != ''
      AND date(m.due_date) >= date(?)
      AND date(m.due_date) <= date(?, '+3 days')
  `;

  const trendsSalesSql = `
    SELECT
      date(i.created_at) AS period,
      COUNT(i.id) AS invoices_count,
      IFNULL(SUM(${sqlInvThbTotalRow()}), 0) AS sales_total,
      IFNULL(SUM(${sqlInvThbPaidRow()}), 0) AS collected_total,
      IFNULL(SUM(${sqlInvThbOutstandingRow()}), 0) AS outstanding_total
    FROM invoices i
    LEFT JOIN ${paymentsAgg} ON ip.invoice_id = i.id
    ${SQL_INV_FX_JOIN}
    WHERE i.created_at >= ? AND i.created_at < ?
    GROUP BY period
    ORDER BY period ASC
  `;

  const latestStockSql = `
    SELECT
      sm.id,
      sm.type,
      sm.qty_change,
      sm.note,
      sm.created_at,
      u.username AS user_name,
      inv.item_code AS item_code,
      inv.item_sticker AS item_sticker
    FROM stock_movements sm
    LEFT JOIN users u ON u.id = sm.user_id
    LEFT JOIN inventory_items inv ON inv.id = sm.inventory_item_id
    ORDER BY sm.created_at DESC, sm.id DESC
    LIMIT 8
  `;

  const todayParams = [todayStartSql, todayEndSql];
  const todayRows = await dbAll(todaySalesSql, todayParams);
  let todaySales = todayRows?.[0] || null;
  if (!todaySales) {
    todaySales = {
      invoices_count: 0,
      sales_total: 0,
      collected_total: 0,
      outstanding_total: 0,
      paid_invoices: 0,
      partial_invoices: 0,
      unpaid_invoices: 0,
    };
  }
  const itemsSoldRows = await dbAll(itemsSoldTodaySql, todayParams);
  const items_sold_today = Number(itemsSoldRows?.[0]?.items_sold || 0);

  const outstandingRows = await dbAll(outstandingAllSql, []);
  const outstanding_all = outstandingRows?.[0] || { outstanding_total: 0, outstanding_invoice_count: 0 };

  const openMemoRows = await dbAll(openMemosSql, []);
  const memosDueRows = await dbAll(memosDueSoonSql, [businessToday, businessToday]);

  const trendRows = await dbAll(trendsSalesSql, [trendFromSql, trendToSql]);
  const latestRows = await dbAll(latestStockSql, []);

  const dashDoc = {
    days: Math.max(2, Math.min(366, Number(dashboardDays) || 30)),
    business_today: businessToday,
    business_tz: BUSINESS_TZ,
    today_sales_bounds: { start: todayStartSql, end: todayEndSql },
    trend_range_ymd: { from: trendFromYmd, to: trendToYmd },
    todaySales,
    items_sold_today,
    outstanding_all: {
      outstanding_total: Number(outstanding_all.outstanding_total || 0),
      invoice_count: Number(outstanding_all.outstanding_invoice_count || 0),
    },
    memos_summary: {
      open_count: Number(openMemoRows?.[0]?.open_memos || 0),
      due_within_3_days: Number(memosDueRows?.[0]?.due_soon || 0),
    },
    trends: { sales: trendRows || [] },
    latest_stock_movements: latestRows || [],
    syncedAt: nowIso,
  };

  // ----- Reports page snapshots (summary + trends) -----
  const now = new Date();
  const to = ymdNowUtc();
  const from = new Date(now.getTime() - (Math.max(2, Number(reportsRangeDays) || 30) - 1) * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const {
    SQL_INV_LINES_SUM_JOIN,
    SQL_INVITEM_FX_JOIN,
    SQL_THB_PER_INV,
    SQL_LINE_PURCH_COST_THB,
    SQL_INV_LINE_NET,
    sqlInvLineThbGrossRow,
  } = sqlPieces;

  const dateWhereSales = 'date(i.created_at) BETWEEN date(?) AND date(?)';
  const dateWhereInvoices = 'date(i.created_at) BETWEEN date(?) AND date(?)';
  const dateWhereMemos = 'date(m.memo_date) BETWEEN date(?) AND date(?)';

  const salesSql = `
    SELECT
      COUNT(i.id) AS invoices_count,
      IFNULL(SUM(${sqlInvThbTotalRow()}), 0) AS sales_total,
      IFNULL(SUM(${sqlInvThbPaidRow()}), 0) AS collected_total,
      IFNULL(SUM(${sqlInvThbOutstandingRow()}), 0) AS outstanding_total,
      SUM(CASE WHEN i.status = 'Paid' THEN 1 ELSE 0 END) AS paid_invoices,
      SUM(CASE WHEN i.status = 'Partial' THEN 1 ELSE 0 END) AS partial_invoices,
      SUM(CASE WHEN i.status = 'Unpaid' THEN 1 ELSE 0 END) AS unpaid_invoices
    FROM invoices i
    LEFT JOIN ${paymentsAgg} ON ip.invoice_id = i.id
    ${SQL_INV_FX_JOIN}
    WHERE ${dateWhereSales}
  `;

  const profitSql = `
    SELECT
      IFNULL(SUM(${sqlInvLineThbGrossRow()}), 0) AS selling_total,
      IFNULL(SUM(${SQL_LINE_PURCH_COST_THB}), 0) AS cost_total,
      IFNULL(SUM((${SQL_INV_LINE_NET}) * ${SQL_THB_PER_INV} - ${SQL_LINE_PURCH_COST_THB}), 0) AS profit_total,
      CASE
        WHEN IFNULL(SUM((${SQL_INV_LINE_NET}) * ${SQL_THB_PER_INV}), 0) > 0
        THEN ROUND(
          (SUM((${SQL_INV_LINE_NET}) * ${SQL_THB_PER_INV} - ${SQL_LINE_PURCH_COST_THB}) * 100.0)
          / SUM((${SQL_INV_LINE_NET}) * ${SQL_THB_PER_INV}),
          2
        )
        ELSE 0
      END AS profit_margin_pct
    FROM invoices i
    JOIN invoice_items ii ON ii.invoice_id = i.id
    JOIN inventory_items inv ON inv.id = ii.inventory_item_id
    ${SQL_INV_LINES_SUM_JOIN}
    ${SQL_INV_FX_JOIN}
    ${SQL_INVITEM_FX_JOIN}
    WHERE ${dateWhereInvoices}
  `;

  const inventoryValueSql = `
    SELECT
      IFNULL(SUM(inv.pieces_remaining), 0) AS remaining_pcs,
      IFNULL(SUM(inv.pieces_remaining * IFNULL(inv.selling_total_price, 0)), 0) AS inventory_value
    FROM inventory_items inv
  `;

  const inventoryByStatusSql = `
    SELECT
      inv.status AS status,
      IFNULL(SUM(inv.pieces_remaining), 0) AS pcs_remaining,
      IFNULL(SUM(inv.pieces_remaining * IFNULL(inv.selling_total_price, 0)), 0) AS value
    FROM inventory_items inv
    GROUP BY inv.status
    ORDER BY value DESC
  `;

  const memosSql = `
    SELECT
      m.status,
      COUNT(*) AS memo_count,
      IFNULL(SUM(mi.quantity - mi.returned_qty), 0) AS remaining_qty,
      IFNULL(SUM((mi.quantity - mi.returned_qty) * mi.unit_price * ${sqlPieces.SQL_THB_PER_MEMO}), 0) AS value
    FROM memos m
    ${sqlPieces.SQL_MEMO_FX_JOIN}
    LEFT JOIN memo_items mi ON mi.memo_id = m.id
    WHERE ${dateWhereMemos}
    GROUP BY m.status
  `;

  const topCustomersSql = `
    SELECT
      c.id,
      c.name,
      c.phone,
      COUNT(i.id) AS invoices_count,
      IFNULL(SUM(${sqlInvThbTotalRow()}), 0) AS total_invoiced,
      IFNULL(SUM(${sqlInvThbPaidRow()}), 0) AS total_paid,
      IFNULL(SUM(${sqlInvThbOutstandingRow()}), 0) AS total_owed,
      MAX(i.created_at) AS last_invoice_at
    FROM customers c
    JOIN invoices i ON i.customer_id = c.id
    LEFT JOIN ${paymentsAgg} ON ip.invoice_id = i.id
    ${SQL_INV_FX_JOIN}
    WHERE ${dateWhereInvoices}
    GROUP BY c.id
    ORDER BY total_owed DESC
    LIMIT ?
  `;

  const topItemsSql = `
    SELECT
      inv.id AS inventory_item_id,
      COALESCE(inv.item_code, inv.item_sticker) AS item_code,
      inv.category,
      inv.item_type,
      IFNULL(SUM(ii.quantity), 0) AS qty_sold,
      IFNULL(SUM((${SQL_INV_LINE_NET}) * ${SQL_THB_PER_INV}), 0) AS sales_value,
      IFNULL(SUM(${SQL_LINE_PURCH_COST_THB}), 0) AS cost_total,
      IFNULL(SUM((${SQL_INV_LINE_NET}) * ${SQL_THB_PER_INV} - ${SQL_LINE_PURCH_COST_THB}), 0) AS profit_value
    FROM invoices i
    JOIN invoice_items ii ON ii.invoice_id = i.id
    JOIN inventory_items inv ON inv.id = ii.inventory_item_id
    ${SQL_INV_LINES_SUM_JOIN}
    ${SQL_INV_FX_JOIN}
    ${SQL_INVITEM_FX_JOIN}
    WHERE ${dateWhereInvoices}
    GROUP BY inv.id
    ORDER BY qty_sold DESC, sales_value DESC
    LIMIT ?
  `;

  const latestStockMovementsSql = `
    SELECT
      sm.id,
      sm.inventory_item_id,
      sm.type,
      sm.ref_type,
      sm.ref_id,
      sm.qty_change,
      sm.note,
      sm.created_at,
      u.username AS user_name
    FROM stock_movements sm
    LEFT JOIN users u ON u.id = sm.user_id
    ORDER BY sm.created_at DESC, sm.id DESC
    LIMIT 20
  `;

  const [
    salesRows,
    profitRows,
    invValueRows,
    invByStatusRows,
    memoRows,
    topCustRows,
    topItemsRows,
    latestMovRows,
  ] = await Promise.all([
    dbAll(salesSql, [from, to]),
    dbAll(profitSql, [from, to]),
    dbAll(inventoryValueSql, []),
    dbAll(inventoryByStatusSql, []),
    dbAll(memosSql, [from, to]),
    dbAll(topCustomersSql, [from, to, reportsTop]),
    dbAll(topItemsSql, [from, to, reportsTop]),
    dbAll(latestStockMovementsSql, []),
  ]);

  const summaryDoc = {
    range: { from, to },
    sales: salesRows?.[0] || {
      invoices_count: 0,
      sales_total: 0,
      collected_total: 0,
      outstanding_total: 0,
      paid_invoices: 0,
      partial_invoices: 0,
      unpaid_invoices: 0,
    },
    profit: profitRows?.[0] || { selling_total: 0, cost_total: 0, profit_total: 0, profit_margin_pct: 0 },
    inventory: invValueRows?.[0] || { remaining_pcs: 0, inventory_value: 0 },
    inventory_by_status: invByStatusRows || [],
    memos_by_status: memoRows || [],
    top_customers: topCustRows || [],
    top_items: topItemsRows || [],
    latest_stock_movements: latestMovRows || [],
    syncedAt: nowIso,
  };

  // trends: keep same default group as UI uses
  const group = 'daily';
  const salesTrendSql = `
    SELECT
      date(i.created_at) AS period,
      COUNT(i.id) AS invoices_count,
      IFNULL(SUM(${sqlInvThbTotalRow()}), 0) AS sales_total,
      IFNULL(SUM(${sqlInvThbPaidRow()}), 0) AS collected_total,
      IFNULL(SUM(${sqlInvThbOutstandingRow()}), 0) AS outstanding_total
    FROM invoices i
    LEFT JOIN ${paymentsAgg} ON ip.invoice_id = i.id
    ${SQL_INV_FX_JOIN}
    WHERE date(i.created_at) BETWEEN date(?) AND date(?)
    GROUP BY period
    ORDER BY period ASC
  `;
  const profitTrendSql = `
    SELECT
      date(i.created_at) AS period,
      IFNULL(SUM(${sqlInvLineThbGrossRow()}), 0) AS selling_total,
      IFNULL(SUM(${SQL_LINE_PURCH_COST_THB}), 0) AS cost_total,
      IFNULL(SUM((${SQL_INV_LINE_NET}) * ${SQL_THB_PER_INV} - ${SQL_LINE_PURCH_COST_THB}), 0) AS profit_total
    FROM invoices i
    JOIN invoice_items ii ON ii.invoice_id = i.id
    JOIN inventory_items inv ON inv.id = ii.inventory_item_id
    ${SQL_INV_LINES_SUM_JOIN}
    ${SQL_INV_FX_JOIN}
    ${SQL_INVITEM_FX_JOIN}
    WHERE date(i.created_at) BETWEEN date(?) AND date(?)
    GROUP BY period
    ORDER BY period ASC
  `;

  const [salesTrendRows, profitTrendRows] = await Promise.all([
    dbAll(salesTrendSql, [from, to]),
    dbAll(profitTrendSql, [from, to]),
  ]);

  const trendsDoc = {
    range: { from, to },
    group,
    sales: salesTrendRows || [],
    profit: profitTrendRows || [],
    syncedAt: nowIso,
  };

  // ----- Monthly inventory report snapshot (owner report) -----
  const yr = Number.isFinite(Number(monthlyYear)) ? Math.floor(Number(monthlyYear)) : new Date().getFullYear();
  const mo = Number.isFinite(Number(monthlyMonth)) ? Math.floor(Number(monthlyMonth)) : new Date().getMonth() + 1;
  const ym = `${yr}-${String(mo).padStart(2, '0')}`;

  let inventoryMonthlyDoc = { year: yr, month: mo, ym, items: [], summary: null, fx: null, syncedAt: nowIso };
  if (typeof buildInventoryMonthlyReport === 'function') {
    const payload = await buildInventoryMonthlyReport(yr, mo);
    inventoryMonthlyDoc = { ...payload, syncedAt: nowIso };
  }

  // ----- Firestore writes (single batch) -----
  const batch = fs.batch();
  batch.set(shopRef.collection('public').doc('exchangeRates'), ratesDoc, { merge: true });
  batch.set(shopRef.collection('public').doc('checkInventory'), checkInventoryDoc, { merge: true });
  batch.set(shopRef.collection('public').doc('dashboardOverview'), dashDoc, { merge: true });
  batch.set(shopRef.collection('public').doc('reportsSummary'), summaryDoc, { merge: true });
  batch.set(shopRef.collection('public').doc('reportsTrends'), trendsDoc, { merge: true });
  batch.set(shopRef.collection('public').doc(`inventoryMonthly_${ym}`), inventoryMonthlyDoc, { merge: true });
  batch.set(shopRef.collection('public').doc('meta'), { lastSyncAt: nowIso }, { merge: true });

  await batch.commit();

  return {
    ok: true,
    shopId: String(shopId).trim(),
    syncedAt: nowIso,
    wrote: [
      'exchangeRates',
      'checkInventory',
      'dashboardOverview',
      'reportsSummary',
      'reportsTrends',
      `inventoryMonthly_${ym}`,
      'meta',
    ],
  };
}

module.exports = { syncToFirestore };

