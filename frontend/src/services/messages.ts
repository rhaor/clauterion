import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functionsClient } from '../lib/firebase'
import type { Message } from '../types/message'

const getMessagesCollection = (topicId: string) =>
  collection(db, 'topics', topicId, 'messages')

export function listenToMessages(
  topicId: string,
  onUpdate: (messages: Message[]) => void,
) {
  const q = query(getMessagesCollection(topicId), orderBy('createdAt', 'asc'))
  return onSnapshot(q, (snapshot) => {
    const messages: Message[] = snapshot.docs.map((doc) => {
      const data = doc.data()
      return {
        id: doc.id,
        content: data.content ?? '',
        role: data.role ?? 'user',
        authorId: data.authorId ?? '',
        createdAt: data.createdAt?.toDate?.(),
      }
    })
    onUpdate(messages)
  })
}

export async function addUserMessage(topicId: string, params: { content: string; authorId: string }) {
  if (!params.content.trim()) {
    throw new Error('Message content is required')
  }

  await addDoc(getMessagesCollection(topicId), {
    content: params.content,
    role: 'user',
    authorId: params.authorId,
    createdAt: serverTimestamp(),
  })
}

type SendToClaudeResponse = {
  messageId: string
  content: string
}

export async function requestClaudeReply(input: { topicId: string; content: string }) {
  const callable = httpsCallable(functionsClient, 'createAssistantMessage')
  const result = await callable(input)
  return result.data as SendToClaudeResponse
}

