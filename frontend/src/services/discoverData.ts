import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'

export type DiscoverData = {
  pairId: string
  selectedMessageId: string | null
  suggestions: string[]
  dimension?: string
  createdAt?: Date
  updatedAt?: Date
}

const getDiscoverDataDoc = (topicId: string, messageId: string, pairId: string) =>
  doc(db, 'topics', topicId, 'messages', messageId, 'discoverData', pairId)

export function listenToDiscoverData(
  topicId: string,
  messageId: string,
  pairId: string,
  onUpdate: (data: DiscoverData | null) => void,
  onError?: (error: unknown) => void,
) {
  const docRef = getDiscoverDataDoc(topicId, messageId, pairId)
  return onSnapshot(
    docRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        onUpdate(null)
        return
      }
      const data = snapshot.data()
      onUpdate({
        pairId: data.pairId ?? pairId,
        selectedMessageId: data.selectedMessageId ?? null,
        suggestions: data.suggestions ?? [],
        dimension: data.dimension,
        createdAt: data.createdAt?.toDate?.(),
        updatedAt: data.updatedAt?.toDate?.(),
      })
    },
    (error) => {
      if (onError) onError(error)
      console.error('listenToDiscoverData error', error)
    },
  )
}

export async function saveDiscoverData(
  topicId: string,
  messageId: string,
  pairId: string,
  data: { selectedMessageId?: string | null; suggestions?: string[]; dimension?: string },
) {
  const docRef = getDiscoverDataDoc(topicId, messageId, pairId)
  const existingDoc = await getDoc(docRef)
  
  const updateData: {
    pairId: string
    selectedMessageId?: string | null
    suggestions?: string[]
    dimension?: string
    updatedAt: any
    createdAt?: any
  } = {
    pairId,
    updatedAt: serverTimestamp(),
  }

  if (data.selectedMessageId !== undefined) {
    updateData.selectedMessageId = data.selectedMessageId
  }
  if (data.suggestions !== undefined) {
    updateData.suggestions = data.suggestions
  }
  if (data.dimension !== undefined) {
    updateData.dimension = data.dimension
  }

  if (!existingDoc.exists()) {
    updateData.createdAt = serverTimestamp()
  }

  await setDoc(docRef, updateData, { merge: true })
}
