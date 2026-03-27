# Product features — reference

## Adding a customer

When staff **add a customer** (Customers page **+ Add Customer**, or **Selling** quick-add), the app should collect enough detail for invoices, memos, and follow-up.

| Area | Fields | Required |
|------|--------|----------|
| **Contact** | Name | Yes |
| | Phone | Recommended (search, memos, receipts) |
| | Email | Optional |
| **Mailing address** | Line 1, line 2, city, postal code, country | Optional at save; encouraged for documents |
| **Internal** | Notes | Optional |

**Backend:** `POST /api/customers` accepts all of the above (`name`, `phone`, `email`, `notes`, `address_line1`, `address_line2`, `city`, `postal_code`, `country`).

**UI:** Customers page add-modal matches Selling’s new-customer fields so behavior is consistent.

Future ideas (not in schema yet): company / trade name, tax ID, preferred currency, tags.

## Users, owner, and staff access

- **Default owner** is seeded on first run: username `owner`, password `Owner@123` — change in **Profile → Account & password** (requires current password).
- **Staff** rows store `allowed_pages` (JSON array of page ids). **Profile** is always available for every user (sign out).
- **Owner** sees all app pages. **Staff** only see pages listed for their account (sidebar + top quick nav stay in sync).
- **Owner → Profile → Team & staff access:** add staff (username + initial password + page checkboxes), **Edit** to change username, set a new password, or change page access. Changes apply on next API call (session reloads permissions from DB via `GET /api/account` on Profile mount).
- **API (owner only):** `GET /api/users`, `POST /api/users`, `PATCH /api/users/:id` (staff targets only). **Any user:** `GET /api/account`, `PATCH /api/account` (current password + optional new username/password).

**Note:** Business APIs (`/api/invoices`, etc.) still allow both roles; restricting sensitive APIs to owner-only would be a separate hardening step.
