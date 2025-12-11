import { getApp, getApps, initializeApp } from 'firebase-admin/app'

export function getFirebaseApp() {
  if (getApps().length) {
    return getApp()
  }
  return initializeApp()
}

