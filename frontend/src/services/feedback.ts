import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore'
import { db } from '../lib/firebase'

export type Feedback = {
  id: string
  messageId: string
  content: string
  createdAt?: Date
}

const getFeedbackCollection = (topicId: string, messageId: string) =>
  collection(db, 'topics', topicId, 'messages', messageId, 'feedback')

export function listenToFeedback(
  topicId: string,
  messageId: string,
  onUpdate: (feedback: Feedback | null) => void,
  onError?: (error: unknown) => void,
) {
  const q = query(getFeedbackCollection(topicId, messageId))
  return onSnapshot(
    q,
    (snapshot) => {
      if (snapshot.docs.length === 0) {
        onUpdate(null)
        return
      }
      // Get the first feedback document (there should only be one per message)
      const feedbackDoc = snapshot.docs[0]
      const data = feedbackDoc.data()
      const feedback: Feedback = {
        id: feedbackDoc.id,
        messageId: data.messageId ?? messageId,
        content: data.content ?? '',
        createdAt: data.createdAt?.toDate?.(),
      }
      onUpdate(feedback)
    },
    (error) => {
      if (onError) onError(error)
      console.error('listenToFeedback error', error)
    },
  )
}

export async function getFeedback(topicId: string, messageId: string): Promise<Feedback | null> {
  const feedbackCollection = getFeedbackCollection(topicId, messageId)
  const feedbackSnapshot = await feedbackCollection.get()
  
  if (feedbackSnapshot.docs.length === 0) {
    return null
  }
  
  const feedbackDoc = feedbackSnapshot.docs[0]
  const data = feedbackDoc.data()
  return {
    id: feedbackDoc.id,
    messageId: data.messageId ?? messageId,
    content: data.content ?? '',
    createdAt: data.createdAt?.toDate?.(),
  }
}
