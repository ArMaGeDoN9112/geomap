import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { MapControls, MapInspection, defaultStudyHighlights } from './mapPresentation'
import { createGlobe, loadElevation } from './globeScene'

const arrows = {
  ArrowLeft: [0.13, 0], ArrowRight: [-0.13, 0], ArrowUp: [0, 0.13], ArrowDown: [0, -0.13],
}

export default function GlobeView({ atlas, political, taskNumber, highlight, studyHighlights, hoverKinds, marker, feedback, onSelect, controlsTarget }) {
  const element = useRef(null)
  const pin = useRef(null)
  const globe = useRef(null)
  const [status, setStatus] = useState('loading')
  const [hovered, setHovered] = useState(null)
  const training = taskNumber !== undefined
  const kinds = training ? defaultStudyHighlights : studyHighlights
  const missed = Boolean(feedback && !feedback.correct)
  const outlined = missed ? feedback.object_id : feedback ? null
    : !training || !political || highlight ? hovered?.id ?? marker?.objectId : null

  const pickPoint = useEffectEvent((x, y, hovering) => globe.current.pick(x, y, !training, hovering ? hoverKinds : undefined))
  const initGlobe = useEffectEvent((container, grid, overview) =>
    createGlobe(container, pin.current, atlas, political, grid, overview, kinds))

  const select = useEffectEvent((point, needsConfirmation) => {
    if (!point) return
    if (training) {
      const { latitude, longitude, object } = point
      onSelect({ latitude, longitude, objectId: object?.id, needsConfirmation })
    } else {
      setHovered(point.object ?? null)
    }
  })

  useEffect(() => {
    const container = element.current
    const controller = new AbortController()
    const overview = new Image()
    overview.src = political ? '/physical-relief.webp' : '/globe-satellite.jpg'
    setStatus('loading')
    setHovered(null)

    let hoverFrame = null
    let hoverEvent = null
    const cancelHover = () => {
      if (hoverFrame !== null) cancelAnimationFrame(hoverFrame)
      hoverFrame = null
      hoverEvent = null
    }
    const clear = () => {
      cancelHover()
      setHovered(null)
    }
    const pointerLeave = (event) => {
      if (event.pointerType === 'mouse') clear()
      else cancelHover()
    }
    let pressed = null
    const pointers = new Set()
    const pick = (event, hovering) => {
      const { left, top, width, height } = container.getBoundingClientRect()
      return pickPoint(2 * (event.clientX - left) / width - 1, 1 - 2 * (event.clientY - top) / height, hovering)
    }
    const pointerDown = (event) => {
      cancelHover()
      pointers.add(event.pointerId)
      pressed = pointers.size === 1 && event.button === 0 ? event : null
    }
    const pointerMove = (event) => {
      if (!globe.current) return
      if (pointers.size) {
        if (pressed && Math.hypot(event.clientX - pressed.clientX, event.clientY - pressed.clientY) > 4) {
          pressed = null
          clear()
        }
      } else if (event.pointerType !== 'touch' && !event.buttons) {
        hoverEvent = event
        if (hoverFrame === null) hoverFrame = requestAnimationFrame(() => {
          hoverFrame = null
          setHovered(pick(hoverEvent, true)?.object ?? null)
          hoverEvent = null
        })
      }
    }
    const pointerUp = (event) => {
      pointers.delete(event.pointerId)
      if (globe.current && pressed?.pointerId === event.pointerId &&
        Math.hypot(event.clientX - pressed.clientX, event.clientY - pressed.clientY) <= 4) {
        select(pick(event), event.pointerType !== 'mouse')
      }
      pressed = null
    }
    const cancel = (event) => {
      pointers.delete(event.pointerId)
      pressed = null
    }
    const keyDown = (event) => {
      const view = globe.current
      if (!view) return
      if (event.key === 'Escape') {
        clear()
        return
      }
      if (event.key === 'Enter') select(pickPoint(), true)
      else if (arrows[event.key]) view.rotate(...arrows[event.key])
      else if (event.key === '+' || event.key === '=') view.zoomIn()
      else if (event.key === '-') view.zoomOut()
      else return
      if (event.key !== 'Enter') clear()
      event.preventDefault()
    }
    const contextLost = (event) => {
      event.preventDefault()
      cancelHover()
      setStatus('failed')
    }
    const events = {
      pointerdown: pointerDown, pointermove: pointerMove, pointerup: pointerUp, pointerleave: pointerLeave,
      pointercancel: cancel, lostpointercapture: cancel, keydown: keyDown, wheel: clear, webglcontextlost: contextLost,
    }

    Promise.all([loadElevation(controller.signal), overview.decode()]).then(([grid]) => {
      if (controller.signal.aborted) return
      globe.current = initGlobe(container, grid, overview)
      for (const [type, listener] of Object.entries(events)) container.addEventListener(type, listener, true)
      setStatus('ready')
    }).catch((error) => {
      if (controller.signal.aborted) return
      console.error('Could not initialize the globe', error)
      setStatus('failed')
    })
    return () => {
      controller.abort()
      cancelHover()
      for (const [type, listener] of Object.entries(events)) container.removeEventListener(type, listener, true)
      globe.current?.dispose()
      globe.current = null
    }
  }, [atlas, political])

  useEffect(() => {
    setHovered(null)
    if (taskNumber !== 1) globe.current?.reset()
  }, [taskNumber])

  useEffect(() => {
    setHovered(null)
  }, [hoverKinds])

  useEffect(() => {
    if (status === 'ready' && !political) globe.current.setHighlights(kinds)
  }, [status, political, kinds])

  useEffect(() => {
    if (status === 'ready') globe.current.outline(outlined, missed)
  }, [status, outlined, missed])

  useEffect(() => {
    if (status === 'ready') globe.current.mark(marker, missed)
  }, [status, marker, missed])

  useEffect(() => {
    if (status === 'ready' && missed) globe.current.focus(feedback.object_id)
  }, [status, feedback, missed])

  const control = (method) => () => {
    setHovered(null)
    globe.current?.[method]()
  }

  return (
    <>
      <div className="map-canvas globe-canvas" ref={element} tabIndex={status === 'ready' ? 0 : -1}
        role="region" aria-label="Интерактивный глобус" aria-busy={status === 'loading'}
        aria-describedby={!training && hovered ? 'keyboard-guide map-tooltip' : 'keyboard-guide'}>
        <div ref={pin} className="globe-pin" hidden aria-hidden="true" />
      </div>
      <span id="keyboard-guide" className="sr-only">
        Стрелки вращают глобус. Плюс и минус меняют масштаб. Enter выбирает точку в центре глобуса.
      </span>
      {status === 'loading' && <p className="globe-status" role="status">Загружаем рельеф…</p>}
      {status === 'failed' && <p className="globe-status" role="alert">Не удалось открыть глобус. Выбери 2D.</p>}
      {status === 'ready' && (
        <>
          <MapInspection object={!training && hovered} />
          <MapControls zoomIn={control('zoomIn')} zoomOut={control('zoomOut')} reset={control('reset')} target={controlsTarget} />
        </>
      )}
    </>
  )
}
