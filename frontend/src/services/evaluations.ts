import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { Evaluation, EvaluationValue } from '../types/evaluation'

const getEvaluationsCollection = (topicId: string, messageId: string) =>
  collection(db, 'topics', topicId, 'messages', messageId, 'evaluations')

export function listenToEvaluations(
  topicId: string,
  messageId: string,
  onUpdate: (evaluations: Evaluation[]) => void,
  onError?: (error: unknown) => void,
) {
  const q = query(getEvaluationsCollection(topicId, messageId))
  return onSnapshot(
    q,
    (snapshot) => {
      const evaluations: Evaluation[] = snapshot.docs.map((doc) => {
        const data = doc.data()
        return {
          id: doc.id,
          messageId: data.messageId ?? messageId,
          criteriaId: data.criteriaId ?? '',
          value: (data.value as EvaluationValue) ?? 'meh',
          createdAt: data.createdAt?.toDate?.(),
        }
      })
      onUpdate(evaluations)
    },
    (error) => {
      if (onError) onError(error)
      console.error('listenToEvaluations error', error)
    },
  )
}

export async function saveEvaluation(
  topicId: string,
  messageId: string,
  criteriaId: string,
  value: EvaluationValue,
) {
  // Check if evaluation already exists
  const q = query(
    getEvaluationsCollection(topicId, messageId),
    where('criteriaId', '==', criteriaId),
  )
  const snapshot = await getDocs(q)

  if (snapshot.docs.length > 0) {
    // Update existing evaluation
    const evalDoc = snapshot.docs[0]
    await updateDoc(doc(getEvaluationsCollection(topicId, messageId), evalDoc.id), {
      value,
      updatedAt: serverTimestamp(),
    })
    return evalDoc.id
  } else {
    // Create new evaluation
    const docRef = await addDoc(getEvaluationsCollection(topicId, messageId), {
      messageId,
      criteriaId,
      value,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    return docRef.id
  }
}

export async function deleteEvaluation(
  topicId: string,
  messageId: string,
  evaluationId: string,
) {
  await deleteDoc(doc(getEvaluationsCollection(topicId, messageId), evaluationId))
}

