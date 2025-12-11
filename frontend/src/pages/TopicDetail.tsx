import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { useAuth } from '../features/auth/AuthProvider'
import {
  addUserMessage,
  listenToMessages,
  requestClaudeReply,
  generateSuggestions,
} from '../services/messages'
import { fetchTopicById, updateTopicStage } from '../services/topics'
import type { Message } from '../types/message'
import type { Stage } from '../types/topic'
import { fetchCriteria } from '../services/criteria'
import type { Criteria } from '../types/criteria'

export function TopicDetailPage() {
  const { topicId } = useParams<{ topicId: string }>()
  const { user } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [stage, setStage] = useState<Stage | undefined>(undefined)
  const [messagesError, setMessagesError] = useState<string | null>(null)
  const [selectedDiscoverMessage, setSelectedDiscoverMessage] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)

  useEffect(() => {
    if (!topicId?.trim() || !user?.uid) return
    setMessagesError(null)

    const unsubscribe = listenToMessages(
      topicId,
      setMessages,
      (error) => {
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to load messages right now.'
        setMessagesError(message)
      },
    )
    return () => unsubscribe()
  }, [topicId, user?.uid])

  const {
    data: topic,
    isLoading: isTopicLoading,
    error: topicError,
  } = useQuery({
    queryKey: ['topic', topicId],
    queryFn: () => fetchTopicById(topicId!),
    enabled: Boolean(topicId && user?.uid),
  })

  const {
    data: criteria,
    isLoading: criteriaLoading,
    error: criteriaError,
  } = useQuery({
    queryKey: ['criteria', user?.uid],
    queryFn: () => fetchCriteria(user!.uid),
    enabled: Boolean(user?.uid),
  })

  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0)),
    [messages],
  )

  // Create timeline with Discover pairs grouped
  type TimelineItem =
    | { type: 'message'; message: Message }
    | { type: 'pair'; pair: { a?: Message; b?: Message; dimension?: string; timestamp?: number } }

  const messageTimeline = useMemo<TimelineItem[]>(() => {
    if (stage !== 'Discover') {
      return sortedMessages.map((msg) => ({ type: 'message' as const, message: msg }))
    }

    // Group Discover pairs
    const pairsMap = new Map<string, { a?: Message; b?: Message; dimension?: string; timestamp?: number }>()
    const pairIds = new Set<string>()

    sortedMessages.forEach((msg) => {
      if (msg.role === 'assistant' && msg.discoverPairId && msg.discoverVariant) {
        pairIds.add(msg.id)
        const pair = pairsMap.get(msg.discoverPairId) || {}
        if (msg.discoverVariant === 'a') {
          pair.a = msg
        } else if (msg.discoverVariant === 'b') {
          pair.b = msg
        }
        if (msg.discoverDimension) {
          pair.dimension = msg.discoverDimension
        }
        if (msg.createdAt) {
          const ts = msg.createdAt.getTime()
          if (!pair.timestamp || ts < pair.timestamp) {
            pair.timestamp = ts
          }
        }
        pairsMap.set(msg.discoverPairId, pair)
      }
    })

    const pairs = Array.from(pairsMap.values()).sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
    const regularMsgs = sortedMessages.filter((msg) => !pairIds.has(msg.id))

    // Merge pairs and regular messages chronologically
    const timeline: TimelineItem[] = []
    let pairIdx = 0
    let msgIdx = 0

    while (pairIdx < pairs.length || msgIdx < regularMsgs.length) {
      const pairTime = pairs[pairIdx]?.timestamp ?? Infinity
      const msgTime = regularMsgs[msgIdx]?.createdAt?.getTime() ?? Infinity

      if (pairTime <= msgTime && pairIdx < pairs.length) {
        timeline.push({ type: 'pair', pair: pairs[pairIdx] })
        pairIdx++
      } else if (msgIdx < regularMsgs.length) {
        timeline.push({ type: 'message', message: regularMsgs[msgIdx] })
        msgIdx++
      }
    }

    return timeline
  }, [sortedMessages, stage])

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!user || !topicId) throw new Error('Missing topic or user')
      const content = input.trim()
      if (!content) throw new Error('Message content is required')
      await addUserMessage(topicId, { content, authorId: user.uid })
      setInput('')
      const response = await requestClaudeReply({ topicId, content })
      // Reset selection and suggestions when new message is sent
      setSelectedDiscoverMessage(null)
      setSuggestions([])
      return response
    },
  })

  const suggestionsMutation = useMutation({
    mutationFn: async (selectedMessageId: string) => {
      if (!topicId) throw new Error('Missing topic')
      setSuggestionsLoading(true)
      try {
        const result = await generateSuggestions({ topicId, selectedMessageId })
        setSuggestions(result.suggestions)
      } finally {
        setSuggestionsLoading(false)
      }
    },
  })

  const handleSelectDiscoverMessage = (messageId: string) => {
    setSelectedDiscoverMessage(messageId)
    suggestionsMutation.mutate(messageId)
  }

  const handleSuggestionClick = (suggestion: string) => {
    setInput((prev) => (prev ? `${prev} ${suggestion}` : suggestion))
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (sendMutation.isPending) return
    sendMutation.mutate()
  }

  if (!topicId) {
    return <p className="text-slate-600">No topic selected.</p>
  }

  const stageMutation = useMutation({
    mutationFn: (nextStage: Stage) => updateTopicStage(topicId!, nextStage),
  })

  useEffect(() => {
    if (topic) {
      setStage(topic.stage ?? 'Discover')
    }
  }, [topic])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Topic
        </p>
        <h1 className="text-2xl font-semibold text-slate-900">
          {isTopicLoading ? 'Loading topic…' : topic?.title ?? 'Untitled topic'}
        </h1>
        {topicError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Unable to load this topic. You may not have permission or the topic may not exist.
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="text-sm text-slate-800">
          You're currently testing the <span className="font-semibold">{stage}</span> stage. These
          stages contain different levels of scaffolding. In a tool, you could imagine that the tool
          tries to infer which stage you're currently at and show the respective experience.
        </div>
        <select
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30 md:w-48"
          value={stage ?? 'Discover'}
          onChange={(event) => {
            const nextStage = event.target.value as Stage
            setStage(nextStage)
            stageMutation.mutate(nextStage)
          }}
          disabled={stageMutation.isPending}
        >
          <option value="Discover">Discover</option>
          <option value="Define">Define</option>
          <option value="Deploy">Deploy</option>
        </select>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Goals
          </div>
          <p className="text-sm text-slate-800">
            {topic?.description?.trim()
              ? topic.description
              : 'No goals saved for this topic yet.'}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Criteria
          </div>
          {criteriaLoading && (
            <p className="text-sm text-slate-600">Loading criteria…</p>
          )}
          {criteriaError && (
            <p className="text-sm text-red-600">
              {criteriaError instanceof Error
                ? criteriaError.message
                : 'Unable to load criteria'}
            </p>
          )}
          {!criteriaLoading && (
            <div className="space-y-2 text-sm text-slate-800">
              {criteria
                ?.filter((c: Criteria) => c.topicIds.includes(topicId ?? ''))
                ?.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-lg border border-slate-200 bg-sand-50 px-3 py-2"
                  >
                    <div className="font-semibold text-slate-900">
                      {c.title}
                    </div>
                    <p className="text-xs text-slate-600">
                      Linked to {c.topicIds.length} topic
                      {c.topicIds.length === 1 ? '' : 's'}
                    </p>
                  </div>
                ))}
              {criteria?.filter((c) => c.topicIds.includes(topicId ?? ''))
                .length === 0 && (
                <p className="text-sm text-slate-600">
                  No criteria linked to this topic yet.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex min-h-[500px] flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Conversation</p>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
          {messagesError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {messagesError}
            </div>
          )}
          {sortedMessages.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-sand-50 p-4 text-sm text-slate-600">
              No messages yet. Send one to start.
            </div>
          )}
          {sendMutation.isPending && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
              Claude is replying…
            </div>
          )}
          {/* Render message timeline */}
          {messageTimeline.map((item, index) => {
            if (item.type === 'pair') {
              if (stage !== 'Discover') return null
              const pair = item.pair
              const renderMessageCard = (msg: Message | undefined, variant: 'a' | 'b') => {
                if (!msg) return null
                const isSelected = selectedDiscoverMessage === msg.id
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col gap-1 rounded-xl border px-3 py-2 text-sm shadow-sm transition cursor-pointer ${
                      isSelected
                        ? 'border-brand bg-brand-light ring-2 ring-brand'
                        : 'border-brand/40 bg-brand-light text-brand-dark hover:border-brand/60'
                    }`}
                    onClick={() => handleSelectDiscoverMessage(msg.id)}
                  >
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="font-semibold uppercase tracking-wide">
                        Response {variant.toUpperCase()}
                      </span>
                      {msg.createdAt && (
                        <span>
                          {msg.createdAt.toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      )}
                    </div>
                    <div className="prose prose-sm max-w-none leading-relaxed">
                      <ReactMarkdown
                        components={{
                          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                          h1: ({ children }) => <h1 className="mb-2 mt-3 text-lg font-semibold first:mt-0">{children}</h1>,
                          h2: ({ children }) => <h2 className="mb-2 mt-3 text-base font-semibold first:mt-0">{children}</h2>,
                          h3: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h3>,
                          ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>,
                          ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1">{children}</ol>,
                          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                          code: ({ children, className }) => {
                            const isInline = !className
                            return isInline ? (
                              <code className="rounded bg-slate-100 px-1 py-0.5 text-xs font-mono text-slate-800">
                                {children}
                              </code>
                            ) : (
                              <code className="block rounded bg-slate-100 p-2 text-xs font-mono text-slate-800">
                                {children}
                              </code>
                            )
                          },
                          pre: ({ children }) => <pre className="mb-2 overflow-x-auto rounded bg-slate-100 p-2 text-xs">{children}</pre>,
                          blockquote: ({ children }) => (
                            <blockquote className="my-2 border-l-4 border-slate-300 pl-3 italic">
                              {children}
                            </blockquote>
                          ),
                          a: ({ children, href }) => (
                            <a href={href} className="text-brand-dark underline hover:text-brand" target="_blank" rel="noopener noreferrer">
                              {children}
                            </a>
                          ),
                          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                          em: ({ children }) => <em className="italic">{children}</em>,
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                )
              }

              return (
                <div key={`pair-${index}`} className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    {renderMessageCard(pair.a, 'a')}
                    {renderMessageCard(pair.b, 'b')}
                  </div>
                  {selectedDiscoverMessage && (pair.a?.id === selectedDiscoverMessage || pair.b?.id === selectedDiscoverMessage) && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                        Variation Dimension
                      </p>
                      <p className="text-sm text-slate-800 capitalize">{pair.dimension}</p>
                    </div>
                  )}
                  {selectedDiscoverMessage && (pair.a?.id === selectedDiscoverMessage || pair.b?.id === selectedDiscoverMessage) && (
                    <div className="space-y-2">
                      {suggestionsLoading ? (
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                          <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
                          Generating suggestions…
                        </div>
                      ) : suggestions.length > 0 ? (
                        <>
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Continue Exploring
                          </p>
                          <div className="grid gap-2 md:grid-cols-3">
                            {suggestions.map((suggestion, idx) => (
                              <button
                                key={idx}
                                onClick={() => handleSuggestionClick(suggestion)}
                                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-800 shadow-sm transition hover:border-brand hover:bg-brand-light"
                              >
                                {suggestion}
                              </button>
                            ))}
                          </div>
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              )
            }

            // Regular message - TypeScript guard
            if (item.type !== 'message') {
              return null
            }
            const message = item.message
            return (
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
              <div className="prose prose-sm max-w-none leading-relaxed">
                {message.role === 'assistant' ? (
                  <ReactMarkdown
                    components={{
                      p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                      h1: ({ children }) => <h1 className="mb-2 mt-3 text-lg font-semibold first:mt-0">{children}</h1>,
                      h2: ({ children }) => <h2 className="mb-2 mt-3 text-base font-semibold first:mt-0">{children}</h2>,
                      h3: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h3>,
                      ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>,
                      ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1">{children}</ol>,
                      li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                      code: ({ children, className }) => {
                        const isInline = !className
                        return isInline ? (
                          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs font-mono text-slate-800">
                            {children}
                          </code>
                        ) : (
                          <code className="block rounded bg-slate-100 p-2 text-xs font-mono text-slate-800">
                            {children}
                          </code>
                        )
                      },
                      pre: ({ children }) => <pre className="mb-2 overflow-x-auto rounded bg-slate-100 p-2 text-xs">{children}</pre>,
                      blockquote: ({ children }) => (
                        <blockquote className="my-2 border-l-4 border-slate-300 pl-3 italic">
                          {children}
                        </blockquote>
                      ),
                      a: ({ children, href }) => (
                        <a href={href} className="text-brand-dark underline hover:text-brand" target="_blank" rel="noopener noreferrer">
                          {children}
                        </a>
                      ),
                      strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                      em: ({ children }) => <em className="italic">{children}</em>,
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                ) : (
                  <p className="leading-relaxed">{message.content}</p>
                )}
              </div>
            </div>
            )
          })}
        </div>

        <div className="border-t border-slate-100 px-6 py-4">
          <form className="space-y-3" onSubmit={handleSubmit}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={4}
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
            <p className="text-xs text-slate-500">
              Messages are saved to Firestore. Claude replies are returned by the callable function
              defined in Firebase Functions.
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}

