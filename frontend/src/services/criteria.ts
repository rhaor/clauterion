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
import type { Criteria } from '../types/criteria'

const criteriaCollection = collection(db, 'criteria')

type CreateCriteriaInput = {
  title: string
  topicIds: string[]
}

type UpdateCriteriaInput = Partial<CreateCriteriaInput>

export async function fetchCriteria(ownerId: string): Promise<Criteria[]> {
  const q = query(
    criteriaCollection,
    where('ownerId', '==', ownerId),
    orderBy('createdAt', 'desc'),
  )
  const snapshot = await getDocs(q)

  return snapshot.docs.map((doc) => {
    const data = doc.data()
    return {
      id: doc.id,
      ownerId: data.ownerId ?? '',
      title: data.title ?? '',
      topicIds: (data.topicIds as string[]) ?? [],
      createdAt: data.createdAt?.toDate?.(),
      updatedAt: data.updatedAt?.toDate?.(),
    }
  })
}

export async function fetchCriteriaById(
  id: string,
): Promise<Criteria | null> {
  const criteriaRef = doc(criteriaCollection, id)
  const snapshot = await getDoc(criteriaRef)
  if (!snapshot.exists()) return null

  const data = snapshot.data()
  return {
    id: snapshot.id,
    ownerId: data.ownerId ?? '',
    title: data.title ?? '',
    topicIds: (data.topicIds as string[]) ?? [],
    createdAt: data.createdAt?.toDate?.(),
    updatedAt: data.updatedAt?.toDate?.(),
  }
}

export async function createCriteria(
  ownerId: string,
  input: CreateCriteriaInput,
) {
  const title = input.title.trim()
  if (!title) throw new Error('Criteria title is required')

  const docRef = await addDoc(criteriaCollection, {
    title,
    topicIds: input.topicIds ?? [],
    ownerId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  return docRef.id
}

export async function updateCriteria(
  criteriaId: string,
  input: UpdateCriteriaInput,
) {
  const criteriaRef = doc(criteriaCollection, criteriaId)
  await updateDoc(criteriaRef, {
    ...(input.title !== undefined ? { title: input.title.trim() } : {}),
    ...(input.topicIds !== undefined ? { topicIds: input.topicIds } : {}),
    updatedAt: serverTimestamp(),
  })
}

