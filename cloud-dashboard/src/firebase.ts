import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

function env(key: string): string {
  return String((import.meta as any).env[key] || '').trim();
}

export function getApp() {
  if (getApps().length) return getApps()[0]!;
  return initializeApp({
    apiKey: env('VITE_FIREBASE_API_KEY'),
    authDomain: env('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: env('VITE_FIREBASE_PROJECT_ID'),
    storageBucket: env('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: env('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: env('VITE_FIREBASE_APP_ID'),
  });
}

export const auth = getAuth(getApp());
export const db = getFirestore(getApp());

const shopId = env('VITE_SHOP_ID') || 'bluecuts-main';

export async function readDoc<T = any>(id: string): Promise<T> {
  const snap = await getDoc(doc(db, 'shops', shopId, 'public', id));
  if (!snap.exists()) throw new Error(`Missing doc: ${id}`);
  return snap.data() as T;
}

export function monthlyDocId(year: number, month: number): string {
  return `inventoryMonthly_${year}-${String(month).padStart(2, '0')}`;
}
