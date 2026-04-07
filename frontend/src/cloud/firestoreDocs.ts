import { doc, getDoc } from 'firebase/firestore';
import { getFirebaseFirestore } from './firebaseClient';
import { getCloudShopId } from './cloudMode';

function shopPublicDoc(id: string) {
  const shopId = getCloudShopId();
  if (!shopId) throw new Error('Missing REACT_APP_SHOP_ID');
  return doc(getFirebaseFirestore(), 'shops', shopId, 'public', id);
}

export async function readPublicDoc<T = any>(id: string): Promise<T> {
  const snap = await getDoc(shopPublicDoc(id));
  if (!snap.exists()) throw new Error(`Missing Firestore doc: ${id}`);
  return snap.data() as T;
}

export function inventoryMonthlyDocId(year: number, month: number): string {
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  return `inventoryMonthly_${ym}`;
}

