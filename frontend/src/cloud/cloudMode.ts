export function isCloudFirestoreMode(): boolean {
  return String(process.env.REACT_APP_DATA_SOURCE || '').trim().toLowerCase() === 'firebase';
}

export function getCloudShopId(): string {
  return String(process.env.REACT_APP_SHOP_ID || '').trim();
}

