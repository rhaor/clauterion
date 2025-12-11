import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthProvider'
import {
  addUserMessage,
  listenToMessages,
  requestClaudeReply,
} from '../services/messages'
import type { Message } from '../types/message'

export function TopicDetailPage() {
  const { topicId } = useParams<{ topicId: string }>()
  const { user } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')

  useEffect(() => {
    if (!topicId) return
    const unsubscribe = listenToMessages(topicId, setMessages)
    return () => unsubscribe()
  }, [topicId])

  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0)),
    [messages],
  )

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!user || !topicId) throw new Error('Missing topic or user')
      const content = input.trim()
      if (!content) throw new Error('Message content is required')
      await addUserMessage(topicId, { content, authorId: user.uid })
      setInput('')
      await requestClaudeReply({ topicId, content })
    },
  })

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (sendMutation.isPending) return
    sendMutation.mutate()
  }

  if (!topicId) {
    return <p className="text-slate-600">No topic selected.</p>
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-slate-900">Conversation</h1>
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Topic {topicId}
          </span>
        </div>
        <div className="flex flex-col gap-3">
          {sortedMessages.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-sand-50 p-4 text-sm text-slate-600">
              No messages yet. Send one to start.
            </div>
          )}
          {sortedMessages.map((message) => (
            <div
              key={message.id}
              className={`flex flex-col gap-1 rounded-xl border px-3 py-2 text-sm shadow-sm ${
                message.role === 'assistant'
                  ? 'border-brand/40 bg-brand-light text-brand-dark'
                  : 'border-slate-200 bg-white text-slate-800'
              }`}
            >
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-semibold uppercase tracking-wide">
                  {message.role}
                </span>
                {message.createdAt && (
                  <span>
                    {message.createdAt.toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                )}
              </div>
              <p className="leading-relaxed">{message.content}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Prompt Claude</h2>
        <form className="space-y-3" onSubmit={handleSubmit}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={6}
            placeholder="Write a message or question..."
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
          {sendMutation.error && (
            <p className="text-sm text-red-600">
              {sendMutation.error instanceof Error
                ? sendMutation.error.message
                : 'Unable to send message'}
            </p>
          )}
          <button
            type="submit"
            disabled={sendMutation.isPending}
            className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
          >
            {sendMutation.isPending ? 'Sending…' : 'Send to Claude'}
          </button>
        </form>
        <p className="mt-3 text-xs text-slate-500">
          Messages are saved to Firestore. Claude replies are returned by the callable function
          defined in Firebase Functions.
        </p>
      </div>
    </div>
  )
}

