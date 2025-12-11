import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../features/auth/AuthProvider'
import { createTopic, fetchTopics, deleteTopic } from '../services/topics'
import type { Topic } from '../types/topic'

export function TopicsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [titleError, setTitleError] = useState('')

  const { data: topics, isLoading, error } = useQuery({
    queryKey: ['topics', user?.uid],
    queryFn: () => fetchTopics(user!.uid),
    enabled: Boolean(user?.uid),
  })

  const createTopicMutation = useMutation({
    mutationFn: () => createTopic(user!.uid, { title, description }),
    onSuccess: (topicId) => {
      setTitle('')
      setDescription('')
      setTitleError('')
      queryClient.invalidateQueries({ queryKey: ['topics', user?.uid] })
      navigate(`/topics/${topicId}`)
    },
  })

  const deleteTopicMutation = useMutation({
    mutationFn: (topicId: string) => deleteTopic(topicId),
    onSuccess: (_, deletedTopicId) => {
      queryClient.invalidateQueries({ queryKey: ['topics', user?.uid] })
      queryClient.invalidateQueries({ queryKey: ['criteria', user?.uid] })
      queryClient.invalidateQueries({ queryKey: ['topic', deletedTopicId] })
      
      // If user is viewing the deleted topic, redirect to topics page
      if (location.pathname.startsWith(`/topics/${deletedTopicId}`)) {
        navigate('/topics', { replace: true })
      }
    },
  })

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    
    // Clear previous errors
    setTitleError('')
    
    // Validate title
    if (!title.trim()) {
      setTitleError('Topic title is required')
      return
    }
    
    createTopicMutation.mutate()
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Left Column - Existing Topics */}
      <div className="space-y-4">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-900">
            Your topics
          </h2>
          <p className="text-sm text-slate-600">
            Learn about a specific topic with Claude.
          </p>
        </div>
        <div className="space-y-4">
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
            <div
              key={topic.id}
              className="flex w-full flex-col items-start gap-2 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow"
            >
              <div className="flex w-full items-center justify-between gap-3">
                <button
                  onClick={() => navigate(`/topics/${topic.id}`)}
                  className="flex-1 text-left"
                >
                  <h3 className="text-lg font-semibold text-slate-900">
                    {topic.title}
                  </h3>
                  {topic.description && (
                    <p className="text-sm text-slate-600">{topic.description}</p>
                  )}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteTopicMutation.mutate(topic.id)
                  }}
                  disabled={deleteTopicMutation.isPending}
                  className="text-sm font-medium text-red-600 transition hover:text-red-700 disabled:opacity-60"
                >
                  {deleteTopicMutation.isPending ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right Column - Create New Topic */}
      <div>
        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2 className="text-xl font-semibold text-slate-900">
            Create new topic:
          </h2>

          <div className="space-y-2">
            <label
              htmlFor="topic-title"
              className="block text-sm font-medium text-slate-700"
            >
              Topic or area of interest:
            </label>
            <input
              id="topic-title"
              type="text"
              className={`w-full rounded-lg border px-3 py-2 text-sm shadow-sm outline-none transition ${
                titleError
                  ? 'border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-500/30'
                  : 'border-slate-200 focus:border-brand focus:ring-2 focus:ring-brand/30'
              }`}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                if (titleError) setTitleError('')
              }}
            />
            {titleError && (
              <p className="text-sm text-red-600">{titleError}</p>
            )}
          </div>

          <div className="space-y-2">
            <label
              htmlFor="topic-goals"
              className="block text-sm font-medium text-slate-700"
            >
              Goals:
            </label>
            <p className="text-sm text-slate-600">
              Why is this of interest and importance? What do you hope to
              achieve?
            </p>
            <textarea
              id="topic-goals"
              rows={4}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={createTopicMutation.isPending}
            className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
          >
            {createTopicMutation.isPending ? 'Creating...' : 'Create new topic'}
          </button>

          {createTopicMutation.error && (
            <p className="text-sm text-red-600">
              {createTopicMutation.error instanceof Error
                ? createTopicMutation.error.message
                : 'Unable to create topic'}
            </p>
          )}
        </form>
      </div>
    </div>
  )
}

