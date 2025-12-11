import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'

export type DefineSuggestion = {
  suggestion: string
  rationale: string
}

export type DefineSuggestionsData = {
  messageId: string
  suggestions: DefineSuggestion[]
  createdAt?: Date
  updatedAt?: Date
}

const getDefineSuggestionsDoc = (topicId: string, messageId: string) =>
  doc(db, 'topics', topicId, 'messages', messageId, 'defineSuggestions', 'default')

export function listenToDefineSuggestions(
  topicId: string,
  messageId: string,
  onUpdate: (data: DefineSuggestionsData | null) => void,
  onError?: (error: unknown) => void,
) {
  const docRef = getDefineSuggestionsDoc(topicId, messageId)
  return onSnapshot(
    docRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        onUpdate(null)
        return
      }
      const data = snapshot.data()
      // Handle migration from old format (string[]) to new format (DefineSuggestion[])
      const rawSuggestions = data.suggestions ?? []
      const suggestions: DefineSuggestion[] = rawSuggestions.map((item: any) => {
        if (typeof item === 'string') {
          // Old format: just a string
          return { suggestion: item, rationale: '' }
        }
        // New format: object with suggestion and rationale
        return {
          suggestion: item.suggestion ?? item.text ?? '',
          rationale: item.rationale ?? item.reason ?? '',
        }
      })

      onUpdate({
        messageId: data.messageId ?? messageId,
        suggestions,
        createdAt: data.createdAt?.toDate?.(),
        updatedAt: data.updatedAt?.toDate?.(),
      })
    },
    (error) => {
      if (onError) onError(error)
      console.error('listenToDefineSuggestions error', error)
    },
  )
}

export async function saveDefineSuggestions(
  topicId: string,
  messageId: string,
  suggestions: DefineSuggestion[],
) {
  const docRef = getDefineSuggestionsDoc(topicId, messageId)
  const existingDoc = await getDoc(docRef)
  
  const updateData: {
    messageId: string
    suggestions: DefineSuggestion[]
    updatedAt: any
    createdAt?: any
  } = {
    messageId,
    suggestions,
    updatedAt: serverTimestamp(),
  }

  if (!existingDoc.exists()) {
    updateData.createdAt = serverTimestamp()
  }

  await setDoc(docRef, updateData, { merge: true })
}
