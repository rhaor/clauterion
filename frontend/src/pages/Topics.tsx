import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../features/auth/AuthProvider'
import { createTopic, fetchTopics } from '../services/topics'
import type { Topic } from '../types/topic'

export function TopicsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  const { data: topics, isLoading, error } = useQuery({
    queryKey: ['topics', user?.uid],
    queryFn: () => fetchTopics(user!.uid),
    enabled: Boolean(user?.uid),
  })

  const createTopicMutation = useMutation({
    mutationFn: () => createTopic(user!.uid, { title, description }),
    onSuccess: () => {
      setTitle('')
      setDescription('')
      queryClient.invalidateQueries({ queryKey: ['topics', user?.uid] })
    },
  })

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    createTopicMutation.mutate()
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Your topics</h1>
        <p className="text-sm text-slate-600">
          Track conversations and experiments with Claude.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            placeholder="Topic title"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            type="text"
            placeholder="Optional description"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <button
            type="submit"
            disabled={createTopicMutation.isPending}
            className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60 sm:w-auto"
          >
            {createTopicMutation.isPending ? 'Creating...' : 'Create topic'}
          </button>
        </div>
        {createTopicMutation.error && (
          <p className="text-sm text-red-600">
            {createTopicMutation.error instanceof Error
              ? createTopicMutation.error.message
              : 'Unable to create topic'}
          </p>
        )}
      </form>

      <div className="grid gap-4 md:grid-cols-2">
        {isLoading && <p className="text-slate-600">Loading topics…</p>}
        {error && (
          <p className="text-sm text-red-600">
            {error instanceof Error ? error.message : 'Unable to load topics'}
          </p>
        )}
        {!isLoading && !topics?.length && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-sand-50 p-6 text-slate-600">
            No topics yet. Create one to begin.
          </div>
        )}
        {topics?.map((topic: Topic) => (
          <button
            key={topic.id}
            onClick={() => navigate(`/topics/${topic.id}`)}
            className="flex flex-col items-start gap-2 rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow"
          >
            <div className="flex w-full items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">
                {topic.title}
              </h2>
              <span className="rounded-full bg-brand-light px-3 py-1 text-xs font-semibold text-brand-dark">
                Topic
              </span>
            </div>
            {topic.description && (
              <p className="text-sm text-slate-600">{topic.description}</p>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

