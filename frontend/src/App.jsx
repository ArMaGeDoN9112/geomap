import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, Compass, Crosshair, Globe2,
  Link2, MapPin, Mountain, MousePointer2, RotateCcw, Target, X,
} from 'lucide-react'
import { MapView } from './MapView'
import { request } from './api'

const political = /^\/world\/?$/.test(window.location.pathname)
const listPath = political ? '/world' : '/russia'
const listEndpoint = `/api/lists${listPath}`
const defaultCategory = political ? 'world' : 'russia'
const listTitle = political ? 'Страны мира' : 'Природа России'
const ObjectIcon = political ? Globe2 : Mountain

export function App() {
  const [category, setCategory] = useState(() => new URLSearchParams(window.location.search).get('category') || defaultCategory)
  const [count, setCount] = useState(null)
  const [atlas, setAtlas] = useState(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [loadFailed, setLoadFailed] = useState(false)
  const [run, setRun] = useState(null)
  const [result, setResult] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const [selection, setSelection] = useState(null)
  const [highlight, setHighlight] = useState(false)
  const [modal, setModal] = useState(null)
  const [exitPath, setExitPath] = useState(null)
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const inFlight = useRef(false)
  const leaving = useRef(false)
  const heading = useRef(null)
  const training = run !== null
  const task = run?.task
  const ready = atlas?.category === category
  const shareUrl = new URL(listPath, window.location.origin)
  if (category !== defaultCategory) shareUrl.searchParams.set('category', category)

  useEffect(() => {
    if (ready) return
    const controller = new AbortController()
    const options = { signal: controller.signal }
    request(`${listEndpoint}?category=${encodeURIComponent(category)}`, options)
      .then(async (list) => {
        const [lines, land] = await Promise.all([
          list.map.reference_lines && request(list.map.reference_lines, options),
          list.map.land && request(list.map.land, options),
        ])
        if (controller.signal.aborted) return
        document.title = `GeoMap — ${list.title}`
        setAtlas({ category, list, lines, land })
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadFailed(true)
      })
    return () => controller.abort()
  }, [category, loadAttempt, ready])

  useEffect(() => {
    if (!training) return
    const warn = (event) => {
      if (!leaving.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [training])

  useEffect(() => {
    if (task || result) heading.current?.focus({ preventScroll: true })
  }, [task, result])

  useEffect(() => {
    if (!copied) return
    const timeout = setTimeout(() => setCopied(false), 2400)
    return () => clearTimeout(timeout)
  }, [copied])

  async function perform(action) {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setError('')
    try {
      await action()
    } catch (failure) {
      setError(failure.message)
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  function clearAnswer() {
    setFeedback(null)
    setSelection(null)
  }

  function begin(event) {
    event.preventDefault()
    if (!ready) return
    perform(async () => {
      leaving.current = false
      setRun(await request(`${listEndpoint}/training`, {
        method: 'POST',
        body: { name: name.trim() || null, category, count: Number(count ?? atlas.list.training_count) },
      }))
      setResult(null)
      setHighlight(false)
      clearAnswer()
      setModal(null)
    })
  }

  function changeCategory(event) {
    const next = event.target.value
    setCategory(next)
    setCount(null)
    setLoadFailed(false)
    setError('')
    const url = new URL(listPath, window.location.origin)
    if (next !== defaultCategory) url.searchParams.set('category', next)
    window.history.replaceState(null, '', url)
  }

  function retryLoad() {
    setLoadFailed(false)
    setLoadAttempt((attempt) => attempt + 1)
  }

  function submit(point) {
    if (!run || feedback || inFlight.current) return
    setSelection(point)
    perform(async () => {
      const answer = await request(`/api/training/${run.id}/tasks/${task.number}/answer`, {
        method: 'POST',
        body: { latitude: point.latitude, longitude: point.longitude },
      })
      setFeedback(answer)
    })
  }

  function advance() {
    perform(async () => {
      const next = await request(`/api/training/${run.id}/tasks/${task.number}/next`, { method: 'POST' })
      clearAnswer()
      if (next.result) {
        setRun(null)
        setResult(next.result)
      } else {
        setRun({ ...run, task: next.task })
      }
    })
  }

  function openModal(kind, destination = null) {
    setError('')
    setExitPath(destination)
    setModal(kind)
  }

  function returnToStudy() {
    if (training) {
      openModal('exit')
    } else {
      setResult(null)
      setName('')
    }
  }

  function discard() {
    // The server expires abandoned runs if it cannot receive this request.
    request(`/api/training/${run.id}`, { method: 'DELETE', keepalive: true }).catch(() => {})
    setRun(null)
    setModal(null)
    setName('')
    clearAnswer()
    if (exitPath) {
      leaving.current = true
      window.location.assign(exitPath)
    }
  }

  function switchMap(event) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const path = event.currentTarget.pathname
    if (pending || path === listPath || training) event.preventDefault()
    if (!pending && training && path !== listPath) openModal('exit', path)
  }

  async function share() {
    try {
      await navigator.clipboard.writeText(shareUrl.href)
      setCopied(true)
    } catch {
      openModal('share')
    }
  }

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <div className="brand">
            <img src="/compass.svg" width="40" height="40" alt="" />
            <span>GeoMap</span>
          </div>
          <nav className="modes" aria-label="Режим работы">
            <button aria-current={!training && !result ? 'page' : undefined} onClick={returnToStudy} disabled={pending}>
              <BookOpen size={17} /> Изучение
            </button>
            <button aria-current={training || result ? 'page' : undefined} onClick={() => openModal('start')} disabled={!ready || training || pending}>
              <Target size={17} /> Тренировка
            </button>
          </nav>
          <button className="share-button" onClick={share} disabled={pending} aria-label="Поделиться списком">
            {copied ? <Check size={17} /> : <Link2 size={18} />}
            <span>{copied ? 'Ссылка скопирована' : 'Поделиться'}</span>
          </button>
          <span className="sr-only" role="status">{copied ? 'Ссылка скопирована' : ''}</span>
        </div>
      </header>

      <main>
        <nav className="map-switcher" aria-label="Выбор карты">
          <a href="/russia" aria-current={!political ? 'page' : undefined} onClick={switchMap}>
            <Mountain size={16} aria-hidden="true" /> Физическая
          </a>
          <a href="/world" aria-current={political ? 'page' : undefined} onClick={switchMap}>
            <Globe2 size={16} aria-hidden="true" /> Политическая
          </a>
        </nav>
        {result ? (
          <section className="result-card">
            <div className="panel-icon"><Target size={23} /></div>
            <h1 ref={heading} tabIndex={-1}>Результат тренировки</h1>
            {result.name && <p className="student-name">{result.name}</p>}
            <p className="score"><strong>{result.correct}</strong><span> / {result.total}</span></p>
            <p className="score-label">Правильных ответов</p>
            {result.missed.length ? (
              <div className="missed-list">
                <h2>Стоит повторить</h2>
                <ul>{result.missed.map((object) => <li key={object.id}><ObjectIcon size={16} />{object.name}</li>)}</ul>
              </div>
            ) : <p className="perfect">Все объекты найдены верно.</p>}
            <div className="result-actions">
              <button className="secondary" onClick={returnToStudy}><ArrowLeft size={17} /> К изучению</button>
              <button className="primary" onClick={() => openModal('start')}><RotateCcw size={17} /> Пройти ещё раз</button>
            </div>
          </section>
        ) : (
          <>
            <div className="page-intro">
              <div className="eyebrow"><Compass size={16} /> {political ? 'Политическая карта' : 'Физическая карта'}</div>
              <h1>{ready ? atlas.list.title : listTitle}</h1>
            </div>
            {atlas ? (
              <div className="workspace">
                <aside className="activity" aria-label={training ? 'Тренировка' : 'Изучение'}>
                  {training ? (
                    <>
                      <div className="task-status">
                        <span>Задание {task.number} из {task.total}</span>
                        <strong>{Math.round(task.number / task.total * 100)}%</strong>
                      </div>
                      <progress max={task.total} value={task.number} aria-label="Номер задания" />
                      <h2 ref={heading} tabIndex={-1} className="task-prompt">{task.prompt}</h2>
                      {!feedback && (
                        <>
                          <p className="desktop-hint">Укажи объект кликом по карте.</p>
                          <p className="touch-hint">Поставь метку на карте и подтверди ответ.</p>
                          <p className="hybrid-hint">Клик отправляет ответ. Касанием можно поставить метку и подтвердить её кнопкой.</p>
                          {political && (
                            <label className="switch-row">
                              <Crosshair size={20} />
                              <span>Подсветка контуров</span>
                              <input type="checkbox" role="switch" checked={highlight} onChange={(event) => setHighlight(event.target.checked)} />
                            </label>
                          )}
                        </>
                      )}
                      {feedback && (
                        <div className={`feedback ${feedback.correct ? 'correct' : 'incorrect'}`} role="status">
                          {feedback.correct ? <Check size={20} /> : <MapPin size={20} />}
                          <div>
                            <strong>{feedback.correct ? 'Верно!' : 'Промах'}</strong>
                            {!feedback.correct && <p>Расстояние до объекта · {feedback.distance_label}</p>}
                          </div>
                        </div>
                      )}
                      {!modal && error && <p className="error" role="alert">{error}</p>}
                      <div className="activity-actions">
                        {feedback ? (
                          <button className="primary" onClick={advance} disabled={pending}>
                            {task.number === task.total ? 'Показать результат' : 'Следующее задание'} <ArrowRight size={18} />
                          </button>
                        ) : (
                          <button className={`primary ${!selection ? 'empty-confirm' : ''}`} onClick={() => submit(selection)} disabled={!selection || pending}>
                            {pending ? 'Проверяем…' : 'Подтвердить'} <Check size={17} />
                          </button>
                        )}
                        <button className="text-button" onClick={returnToStudy} disabled={pending}><ArrowLeft size={16} /> К изучению</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="panel-icon"><BookOpen size={24} /></div>
                      <h2>Изучение</h2>
                      {political ? (
                        <>
                          <p className="desktop-hint">Наведи указатель на страну, чтобы открыть справку.</p>
                          <p className="touch-hint">Коснись страны, чтобы открыть справку.</p>
                          <p className="hybrid-hint">Наведи указатель на страну или коснись её, чтобы открыть справку.</p>
                        </>
                      ) : (
                        <>
                          <p className="desktop-hint">Наведи указатель на горы, реку или озеро, чтобы узнать название.</p>
                          <p className="touch-hint">Коснись гор, реки или озера, чтобы узнать название.</p>
                          <p className="hybrid-hint">Наведи указатель на объект или коснись его, чтобы узнать название.</p>
                        </>
                      )}
                      <div className="map-tip">
                        <MousePointer2 size={20} />
                        <p>{political ? 'Приближай и перемещай карту, чтобы рассмотреть небольшие страны.' : 'На заданиях о вершинах достаточно указать сам горный массив.'}</p>
                      </div>
                      <div className="activity-actions">
                        {ready && <div className="object-count"><ObjectIcon size={17} /> Объектов в списке <strong>{atlas.list.available_count}</strong></div>}
                        <button className="primary" onClick={() => openModal('start')} disabled={!ready}>
                          Начать тренировку <ArrowRight size={18} />
                        </button>
                      </div>
                    </>
                  )}
                </aside>
                {ready ? <MapView
                  atlas={atlas}
                  political={political}
                  taskNumber={task?.number}
                  highlight={highlight && !feedback}
                  marker={feedback ?? selection}
                  feedback={feedback}
                  onSelect={(point) => {
                    if (!training || feedback || inFlight.current) return
                    if (point.needsConfirmation) setSelection(point)
                    else submit(point)
                  }}
                /> : <MapLoading failed={loadFailed} political={political} retry={retryLoad} />}
              </div>
            ) : (
              <MapLoading failed={loadFailed} political={political} retry={retryLoad} />
            )}
          </>
        )}
      </main>

      {modal && (
        <Dialog title={modal === 'start' ? 'Начать тренировку' : modal === 'exit' ? 'Выйти из тренировки?' : 'Ссылка на список'} onClose={() => setModal(null)} pending={pending}>
          {modal === 'start' && (
            <form onSubmit={begin}>
              <label className="input-label" htmlFor="category">Категория</label>
              <select id="category" className="field" value={category} onChange={changeCategory} disabled={pending} autoFocus>
                {atlas.list.categories.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
              </select>
              <label className="input-label" htmlFor="count">Количество заданий</label>
              <input id="count" className="field" type="number" min="1" max={ready ? atlas.list.available_count : undefined}
                required disabled={!ready || pending} value={ready ? (count ?? atlas.list.training_count) : ''}
                onChange={(event) => setCount(event.target.value)}
                aria-describedby="count-limit" />
              <p id="count-limit" role="status">
                {ready ? `Доступно от 1 до ${atlas.list.available_count}.` : loadFailed ? 'Не удалось загрузить категорию.' : 'Загружаем категорию…'}
              </p>
              {loadFailed && <button type="button" className="secondary" onClick={retryLoad}>Повторить</button>}
              <label className="input-label" htmlFor="student">Имя <span>по желанию</span></label>
              <input id="student" className="field" autoComplete="off" maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, Анна" />
              {error && <p className="error" role="alert">{error}</p>}
              <button type="submit" className="primary dialog-primary" disabled={!ready || pending}>
                {pending ? 'Запускаем…' : 'Начать'} <ChevronRight size={18} />
              </button>
            </form>
          )}
          {modal === 'exit' && (
            <>
              <p>{exitPath ? 'При смене карты ответы в этой тренировке будут потеряны.' : 'При возвращении к изучению ответы в этой тренировке будут потеряны.'}</p>
              {error && <p className="error" role="alert">{error}</p>}
              <div className="dialog-actions">
                <button className="secondary" onClick={discard} disabled={pending}>Выйти</button>
                <button className="primary" autoFocus onClick={() => setModal(null)} disabled={pending}>Продолжить</button>
              </div>
            </>
          )}
          {modal === 'share' && (
            <input className="field" aria-label="Ссылка на список" readOnly value={shareUrl.href} onFocus={(event) => event.target.select()} />
          )}
        </Dialog>
      )}
    </>
  )
}

function MapLoading({ failed, political, retry }) {
  return (
    <section className="loading" aria-live="polite">
      {failed ? (
        <>
          <p>Не удалось загрузить {political ? 'политическую' : 'физическую'} карту.</p>
          <button className="secondary" onClick={retry}><RotateCcw size={17} /> Повторить</button>
        </>
      ) : <p>Загружаем карту…</p>}
    </section>
  )
}

function Dialog({ title, children, onClose, pending }) {
  const dialog = useRef(null)

  useEffect(() => {
    const element = dialog.current
    element.showModal()
    return () => element.close()
  }, [])

  return (
    <dialog ref={dialog} aria-labelledby="dialog-title" onCancel={(event) => {
      event.preventDefault()
      if (!pending) onClose()
    }}>
      <div className="dialog-heading">
        <h2 id="dialog-title">{title}</h2>
        <button className="icon-button" onClick={onClose} disabled={pending} aria-label="Закрыть"><X size={20} /></button>
      </div>
      {children}
    </dialog>
  )
}
