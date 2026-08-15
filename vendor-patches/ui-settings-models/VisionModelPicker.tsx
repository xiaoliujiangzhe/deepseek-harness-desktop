/**
 * Vision-model picker: one dropdown over every configured model, persisting
 * the designated vision route into the `vision-fallback` settings namespace.
 * The host-side vision-fallback plugin reads that namespace; when the main
 * model cannot read images, it calls the designated model to describe them.
 * The control renders only when the host exposes the namespace (the plugin
 * is mounted), and hides itself entirely otherwise.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient, ModelProviderGroup, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { getPath } from '@deepseek-ai/dsh-client-schema-form'
import { messageOf } from './store.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** The settings namespace the host-side vision-fallback plugin registers. */
export const VISION_FALLBACK_NS = 'vision-fallback'

/** One selectable route flattened from the model catalog. */
interface RouteOption {
  provider: string
  providerName: string
  model: string
  modelName: string
}

/** Dependencies of {@link VisionModelPicker}. */
export interface VisionModelPickerProps {
  /** Wire faces: the catalog read and the settings write. */
  api: Pick<IApiClient, 'settings' | 'llm'>
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** The vision-fallback namespace view, or undefined while the plugin is absent. */
  namespace: SettingsNamespaceView | undefined
  /** Whether the settings document accepts writes. */
  writable: boolean
  /** Reload the page snapshot after a committed write (refreshes the revision). */
  onSaved: () => void
}

/** Encode one route as a stable option value ('\n' cannot appear in either id). */
function routeValue(provider: string, model: string): string {
  return `${provider}\n${model}`
}

/** Flatten catalog groups into selectable routes in catalog order. */
function flattenGroups(groups: readonly ModelProviderGroup[]): RouteOption[] {
  return groups.flatMap(group => group.models
    // Only models that declare image input can describe an image; a text-only
    // pick would fail the vision call later, so it is never offered here.
    .filter(model => (model.inputModalities ?? []).includes('image'))
    .map(model => ({
      provider: group.id,
      providerName: group.name,
      model: model.id,
      modelName: model.name,
    })))
}

/** Read one string field from the namespace's resolved value. */
function storedField(namespace: SettingsNamespaceView, field: string): string | undefined {
  const value = getPath(namespace.value, [field])
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Render the vision-model dropdown row, or nothing while the host does not
 * expose the vision-fallback namespace.
 * @param props - wire faces, copy, namespace view, and write acknowledgement.
 * @returns the picker row, or null when the feature is absent.
 */
export function VisionModelPicker(props: VisionModelPickerProps): ReactNode {
  const { api, t, namespace, writable, onSaved } = props
  const [options, setOptions] = useState<RouteOption[] | undefined>(undefined)
  const [loadFailure, setLoadFailure] = useState<string | undefined>(undefined)
  const [saveFailure, setSaveFailure] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const enabled = namespace !== undefined

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void api.llm.models({})
      .then((response) => {
        if (cancelled) return
        if (!response.result.ok) {
          setLoadFailure(response.result.error.message)
          return
        }
        setOptions(flattenGroups(response.result.value.groups))
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadFailure(messageOf(error))
      })
    return () => { cancelled = true }
  }, [api, enabled])

  if (namespace === undefined) return null

  const currentProvider = storedField(namespace, 'provider')
  const currentModel = storedField(namespace, 'model')
  const current = currentProvider !== undefined && currentModel !== undefined
    ? routeValue(currentProvider, currentModel)
    : ''
  const known = options ?? []
  // A stored route missing from the catalog (provider removed, model unlisted)
  // stays visible and selected instead of silently snapping to "off".
  const stale = current !== '' && !known.some(option => routeValue(option.provider, option.model) === current)

  const save = (value: string): void => {
    setSaveFailure(undefined)
    setSaving(true)
    const ops = value === ''
      ? [{ op: 'unset' as const, path: ['provider'] }, { op: 'unset' as const, path: ['model'] }]
      : (() => {
        const [provider = '', model = ''] = value.split('\n')
        return [
          { op: 'set' as const, path: ['provider'], value: provider },
          { op: 'set' as const, path: ['model'], value: model },
        ]
      })()
    void api.settings.mutate({ ns: VISION_FALLBACK_NS, ops, expectedRevision: namespace.revision })
      .then((response) => {
        if (!response.result.ok) {
          setSaveFailure(response.result.error.message)
          return
        }
        onSaved()
      })
      .catch((error: unknown) => { setSaveFailure(messageOf(error)) })
      .finally(() => { setSaving(false) })
  }

  return (
    <div className={styles['rowCard']}>
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('visionModel')}</span>
        <select
          className={`${styles['input']} ${styles['selectInput']}`}
          value={current}
          aria-label={t('visionModel')}
          disabled={!writable || saving}
          onChange={(event) => { save(event.target.value) }}
        >
          <option value="">{t('visionModelOff')}</option>
          {stale
            ? <option value={current}>{`${currentProvider ?? ''} / ${currentModel ?? ''}`}</option>
            : null}
          {known.map(option => (
            <option
              key={routeValue(option.provider, option.model)}
              value={routeValue(option.provider, option.model)}
            >
              {`${option.providerName} / ${option.modelName}`}
            </option>
          ))}
        </select>
      </div>
      <p className={styles['advancedHint']}>{t('visionModelHint')}</p>
      {loadFailure === undefined
        ? null
        : <p className={styles['error']}>{`${t('visionModelLoadFailed')}: ${loadFailure}`}</p>}
      {saveFailure === undefined
        ? null
        : <p className={styles['error']}>{`${t('visionModelSaveFailed')}: ${saveFailure}`}</p>}
    </div>
  )
}
