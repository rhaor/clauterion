import {
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { Topic } from '../types/topic'

const topicsCollection = collection(db, 'topics')

type CreateTopicInput = {
  title: string
  description?: string
}

export async function fetchTopics(userId: string): Promise<Topic[]> {
  const q = query(
    topicsCollection,
    where('ownerId', '==', userId),
    orderBy('createdAt', 'desc'),
  )
  const snapshot = await getDocs(q)
  return snapshot.docs.map((doc) => {
    const data = doc.data()
    return {
      id: doc.id,
      title: data.title ?? '',
      description: data.description ?? '',
      ownerId: data.ownerId ?? '',
      createdAt: data.createdAt?.toDate?.(),
    }
  })
}

export async function createTopic(userId: string, input: CreateTopicInput) {
  if (!input.title.trim()) {
    throw new Error('Topic title is required')
  }

  await addDoc(topicsCollection, {
    title: input.title,
    description: input.description ?? '',
    ownerId: userId,
    createdAt: serverTimestamp(),
  })
}

