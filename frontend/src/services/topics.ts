import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { Stage, Topic } from '../types/topic'

const topicsCollection = collection(db, 'topics')

type CreateTopicInput = {
  title: string
  description?: string
  stage?: Stage
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
      stage: data.stage as Stage | undefined,
      createdAt: data.createdAt?.toDate?.(),
    }
  })
}

export async function createTopic(userId: string, input: CreateTopicInput) {
  if (!input.title.trim()) {
    throw new Error('Topic title is required')
  }

  const docRef = await addDoc(topicsCollection, {
    title: input.title,
    description: input.description ?? '',
    ownerId: userId,
    stage: input.stage ?? 'Discover',
    createdAt: serverTimestamp(),
  })
  
  return docRef.id
}

export async function fetchTopicById(topicId: string): Promise<Topic | null> {
  const topicRef = doc(topicsCollection, topicId)
  const snapshot = await getDoc(topicRef)

  if (!snapshot.exists()) return null

  const data = snapshot.data()
  return {
    id: snapshot.id,
    title: data.title ?? '',
    description: data.description ?? '',
    ownerId: data.ownerId ?? '',
    stage: data.stage as Stage | undefined,
    createdAt: data.createdAt?.toDate?.(),
  }
}

export async function updateTopicStage(topicId: string, stage: Stage) {
  const topicRef = doc(topicsCollection, topicId)
  await updateDoc(topicRef, { stage })
}

