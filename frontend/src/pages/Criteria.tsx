import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../features/auth/AuthProvider'
import { fetchTopics } from '../services/topics'
import {
  createCriteria,
  fetchCriteria,
  deleteCriteria,
  updateCriteria,
} from '../services/criteria'
import type { Topic } from '../types/topic'
import type { Criteria } from '../types/criteria'

export function CriteriaPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [title, setTitle] = useState('')
  const [titleError, setTitleError] = useState('')
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([])
  const [criteriaTopicSelections, setCriteriaTopicSelections] = useState<
    Record<string, string[]>
  >({})
  const [criteriaEditOpen, setCriteriaEditOpen] = useState<
    Record<string, boolean>
  >({})

  const {
    data: topics,
    isLoading: topicsLoading,
    error: topicsError,
  } = useQuery({
    queryKey: ['topics', user?.uid],
    queryFn: () => fetchTopics(user!.uid),
    enabled: Boolean(user?.uid),
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

  const createCriteriaMutation = useMutation({
    mutationFn: () =>
      createCriteria(user!.uid, {
        title,
        topicIds: selectedTopicIds,
      }),
    onSuccess: () => {
      setTitle('')
      setSelectedTopicIds([])
      setTitleError('')
      queryClient.invalidateQueries({ queryKey: ['criteria', user?.uid] })
    },
  })

  const deleteCriteriaMutation = useMutation({
    mutationFn: (criteriaId: string) => deleteCriteria(criteriaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['criteria', user?.uid] })
    },
  })

  const updateCriteriaMutation = useMutation({
    mutationFn: ({
      criteriaId,
      topicIds,
    }: {
      criteriaId: string
      topicIds: string[]
    }) => updateCriteria(criteriaId, { topicIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['criteria', user?.uid] })
    },
  })

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    setTitleError('')

    if (!title.trim()) {
      setTitleError('Criteria title is required')
      return
    }

    createCriteriaMutation.mutate()
  }

  const toggleTopicSelection = (topicId: string) => {
    setSelectedTopicIds((prev) =>
      prev.includes(topicId)
        ? prev.filter((id) => id !== topicId)
        : [...prev, topicId],
    )
  }

  const toggleCriteriaTopic = (criteriaId: string, topicId: string) => {
    setCriteriaTopicSelections((prev) => {
      const current = prev[criteriaId] ?? []
      const next = current.includes(topicId)
        ? current.filter((id) => id !== topicId)
        : [...current, topicId]

      updateCriteriaMutation.mutate({
        criteriaId,
        topicIds: next,
      })

      return { ...prev, [criteriaId]: next }
    })
  }

  useEffect(() => {
    if (criteria) {
      const nextSelections: Record<string, string[]> = {}
      const nextOpen: Record<string, boolean> = {}
      criteria.forEach((c) => {
        nextSelections[c.id] = c.topicIds ?? []
        nextOpen[c.id] = false
      })
      setCriteriaTopicSelections(nextSelections)
      setCriteriaEditOpen((prev) => ({ ...nextOpen, ...prev }))
    }
  }, [criteria])

  const topicTitleById = new Map<string, string>(
    (topics ?? []).map((topic) => [topic.id, topic.title]),
  )

  const toggleEditLinks = (item: Criteria) => {
    setCriteriaTopicSelections((prev) => ({
      ...prev,
      [item.id]: prev[item.id] ?? item.topicIds ?? [],
    }))
    setCriteriaEditOpen((prev) => ({
      ...prev,
      [item.id]: !prev[item.id],
    }))
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Left Column - Existing Criteria */}
      <div className="space-y-4">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-900">Criteria</h2>
          <p className="text-sm text-slate-600">
            Explore criteria to evaluate AI responses by.
          </p>
        </div>

        {criteriaLoading && <p className="text-slate-600">Loading criteria…</p>}
        {criteriaError && (
          <p className="text-sm text-red-600">
            {criteriaError instanceof Error
              ? criteriaError.message
              : 'Unable to load criteria'}
          </p>
        )}
        {!criteriaLoading && !criteria?.length && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-sand-50 p-6 text-slate-600">
            No criteria yet. Create one to begin.
          </div>
        )}

        <div className="space-y-4">
          {criteria?.map((item: Criteria) => (
            <div
              key={item.id}
              className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    {item.title}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Linked to {item.topicIds.length} topic
                    {item.topicIds.length === 1 ? '' : 's'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => deleteCriteriaMutation.mutate(item.id)}
                  disabled={deleteCriteriaMutation.isPending}
                  className="text-sm font-medium text-red-600 transition hover:text-red-700 disabled:opacity-60"
                >
                  {deleteCriteriaMutation.isPending ? 'Deleting…' : 'Delete'}
                </button>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Linked topics
                </p>
                <div className="flex flex-wrap gap-2">
                  {(criteriaTopicSelections[item.id] ?? []).map((topicId) => (
                    <span
                      key={topicId}
                      className="rounded-full bg-sand-100 px-3 py-1 text-xs font-medium text-slate-700"
                    >
                      {topicTitleById.get(topicId) ?? 'Unknown topic'}
                    </span>
                  ))}
                  {(criteriaTopicSelections[item.id] ?? []).length === 0 && (
                    <span className="text-xs text-slate-600">
                      No topics linked yet.
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => toggleEditLinks(item)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-sand-50"
                >
                  {criteriaEditOpen[item.id] ? 'Close link editor' : 'Update links'}
                </button>

                {criteriaEditOpen[item.id] && (
                  <div className="space-y-2 rounded-lg border border-slate-200 bg-sand-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Update links
                    </p>
                    <div className="flex flex-col gap-2">
                      {topics?.map((topic: Topic) => {
                        const isUpdating =
                          updateCriteriaMutation.isPending &&
                          updateCriteriaMutation.variables?.criteriaId ===
                            item.id

                        return (
                          <label
                            key={topic.id}
                            className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 shadow-sm"
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand/40"
                              checked={
                                (criteriaTopicSelections[item.id] ?? []).includes(
                                  topic.id,
                                )
                              }
                              onChange={() =>
                                toggleCriteriaTopic(item.id, topic.id)
                              }
                              disabled={isUpdating}
                            />
                            <span>{topic.title}</span>
                          </label>
                        )
                      })}
                      {!topicsLoading && (topics?.length ?? 0) === 0 && (
                        <p className="text-xs text-slate-600">
                          No topics yet. Create a topic to link it.
                        </p>
                      )}
                    </div>
                    {updateCriteriaMutation.error &&
                      updateCriteriaMutation.variables?.criteriaId === item.id && (
                        <p className="text-xs text-red-600">
                          {updateCriteriaMutation.error instanceof Error
                            ? updateCriteriaMutation.error.message
                            : 'Unable to update criteria'}
                        </p>
                      )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right Column - Create Criteria */}
      <div>
        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2 className="text-xl font-semibold text-slate-900">
            Create new criteria
          </h2>

          <div className="space-y-2">
            <label
              htmlFor="criteria-title"
              className="block text-sm font-medium text-slate-700"
            >
              Title
            </label>
            <input
              id="criteria-title"
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
            <p className="text-sm font-medium text-slate-700">Select topics</p>
            {topicsLoading && (
              <p className="text-sm text-slate-600">Loading topics…</p>
            )}
            {topicsError && (
              <p className="text-sm text-red-600">
                {topicsError instanceof Error
                  ? topicsError.message
                  : 'Unable to load topics'}
              </p>
            )}
            {!topicsLoading && (topics?.length ?? 0) === 0 && (
              <p className="text-sm text-slate-600">
                No topics yet. Create a topic to link it here.
              </p>
            )}
            <div className="flex flex-col gap-2">
              {topics?.map((topic: Topic) => (
                <label
                  key={topic.id}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 shadow-sm"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand/40"
                    checked={selectedTopicIds.includes(topic.id)}
                    onChange={() => toggleTopicSelection(topic.id)}
                  />
                  <span>{topic.title}</span>
                </label>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={createCriteriaMutation.isPending}
            className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
          >
            {createCriteriaMutation.isPending
              ? 'Saving...'
              : 'Create criteria'}
          </button>

          {createCriteriaMutation.error && (
            <p className="text-sm text-red-600">
              {createCriteriaMutation.error instanceof Error
                ? createCriteriaMutation.error.message
                : 'Unable to create criteria'}
            </p>
          )}
        </form>
      </div>
    </div>
  )
}


