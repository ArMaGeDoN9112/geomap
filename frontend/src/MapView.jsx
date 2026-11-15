import { useEffect, useEffectEvent, useRef, useState } from 'react'
import L from 'leaflet'
import { Crosshair, Minus, Plus } from 'lucide-react'

const waterStyle = {
  color: '#387a99', weight: 0.8, fillColor: '#82bad2', fillOpacity: 1, smoothFactor: 0,
}
const invisibleArea = { stroke: false, fill: true, fillOpacity: 0, smoothFactor: 0 }
const countryColors = [
  '#e6c994', '#b9d7ae', '#edc2ab', '#b7c8e2', '#e2dca1', '#d5bfdf', '#a9d5cc',
  '#ecc5cf', '#c7d6a4', '#f0d7aa', '#bcc8df', '#e4bca1', '#c6dcd6',
]
const outlineStyle = { color: '#125b50', weight: 3, fillColor: '#91d5ae', fillOpacity: 0.6, smoothFactor: 0, interactive: false }
const physicalOutline = { ...outlineStyle, weight: 2, fill: false }
const missedStyle = { ...outlineStyle, color: '#af4a23', fillColor: '#ef9e67', fillOpacity: 0.72 }
const missedPhysicalOutline = { ...physicalOutline, color: missedStyle.color, weight: 3 }
const formatPopulation = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 })
const formatElevation = new Intl.NumberFormat('ru-RU')
const physicalKinds = { river: 'Река', lake: 'Озеро', mountain: 'Горный массив' }
const russianSeas = [
  [74.5, 37, 'Баренцево море'],
  [75, 73, 'Карское море'],
  [77, 121, 'Море Лаптевых'],
  [75, 159, 'Восточно-Сибирское море'],
  [55.5, 146, 'Охотское море'],
  [59, 187, 'Берингово море'],
]

function objectAt(element) {
  return element?.closest?.('[data-object-id]')?.dataset.objectId
}

function ObjectTooltip({ object }) {
  const { profile, capitals, name } = object
  return (
    <div id="map-tooltip" className="map-tooltip" role="tooltip">
      <div className="map-tooltip-heading">
        {profile?.flag && (
          <span
            className="map-tooltip-flag"
            role="img"
            aria-label={`Флаг · ${name}`}
            style={{ '--flag-column': profile.flag[0], '--flag-row': profile.flag[1] }}
          />
        )}
        <div>
          <strong>{name}</strong>
          {!!capitals?.length && <p>{capitals.length === 1 ? 'Столица' : 'Столицы'} · {capitals.join(', ')}</p>}
        </div>
      </div>
      {profile ? (
        <div className="map-tooltip-facts">
          <p>{profile.region}</p>
          {profile.population > 0 && (
            <p>Население · {formatPopulation.format(profile.population)} чел. ({profile.population_year})</p>
          )}
        </div>
      ) : object.region && (
        <p>{physicalKinds[object.kind]} · {object.region}</p>
      )}
      {object.summit && (
        <p>Высшая точка · {object.summit.name}, {formatElevation.format(object.summit.elevation)} м</p>
      )}
    </div>
  )
}

export function MapView({ atlas, political, taskNumber, highlight, marker, feedback, onSelect }) {
  const element = useRef(null)
  const mapState = useRef(null)
  const hovered = useRef(null)
  const [inspected, setInspected] = useState(null)
  const { map: config, objects } = atlas.list
  const russia = atlas.category === 'russia'
  const training = taskNumber !== undefined

  const inspect = useEffectEvent((hit) => {
    if (!training) setInspected(mapState.current.catalog.get(hit) ?? null)
  })

  const paintOutline = useEffectEvent(() => {
    const { outline, catalog } = mapState.current
    const missed = feedback && !feedback.correct
    const id = missed
      ? feedback.object_id
      : political
        ? highlight && (hovered.current || (marker?.needsConfirmation && marker.objectId))
        : !feedback && hovered.current
    const style = political
      ? (missed ? missedStyle : outlineStyle)
      : (missed ? missedPhysicalOutline : physicalOutline)
    if (outline.id === id && outline.options.style === style) return
    outline.id = id
    outline.options.style = style
    outline.clearLayers()
    if (id) outline.addData(catalog.get(id).geometry)
  })

  const choosePoint = useEffectEvent((hit, position, confirm) => {
    if (training) {
      if (!russia && (position.lng < -180 || position.lng > 180)) return
      const { lat, lng } = russia ? position.wrap() : position
      onSelect({ latitude: lat, longitude: lng, displayLongitude: position.lng, objectId: hit, needsConfirmation: confirm })
    } else {
      inspect(hit)
    }
  })

  useEffect(() => {
    const container = element.current
    const [west, south, east, north] = config.bounds
    const bounds = L.latLngBounds([south, west], [north, east])
    const map = L.map(container, {
      zoomControl: false,
      attributionControl: false,
      doubleClickZoom: false,
      zoomSnap: 0.25,
      minZoom: russia ? 1 : 0,
      maxZoom: political ? 18 : 16,
      maxBounds: russia ? [[15, -72], [85.05, 245]] : [[-85.05, -180], [85.05, 180]],
      maxBoundsViscosity: 1,
      zoomAnimation: false,
      fadeAnimation: false,
    })
    const reset = () => map.fitBounds(bounds, { padding: [political ? 10 : 22, 22], animate: false })
    reset()

    if (atlas.land) {
      map.createPane('land').style.zIndex = 190
      L.geoJSON(atlas.land, {
        pane: 'land', interactive: false, stroke: !russia, color: '#789a96', weight: 0.75,
        fillColor: '#e5e7cb', fillOpacity: 1,
      }).addTo(map)
    }
    if (!political) {
      const limit = 85.0511287798
      L.imageOverlay(config.relief, [[-limit, -180], [limit, 180]], { alt: '' }).addTo(map)
      if (russia) L.imageOverlay(config.relief, [[-limit, 180], [limit, 540]], { alt: '' }).addTo(map)
    }
    if (atlas.lines) {
      const lineStyle = ({ properties }) => properties.kind === 'boundary'
        ? { color: '#5b5153', weight: 1, opacity: 0.63, dashArray: '4 4' }
        : { color: '#547f8b', weight: 0.75, opacity: 0.38 }
      L.geoJSON(atlas.lines, { style: lineStyle, interactive: false }).addTo(map)
      if (russia) {
        L.geoJSON(atlas.lines, {
          style: lineStyle, interactive: false,
          coordsToLatLng: ([longitude, latitude]) => L.latLng(latitude, longitude + 360),
        }).addTo(map)
      }
    }
    if (russia) {
      L.layerGroup([
        ...[30, 60, 90, 120, 150, 180, 210].map((longitude) => L.polyline([[15, longitude], [85, longitude]])),
        ...[30, 45, 60, 75].map((latitude) => L.polyline([[latitude, -72], [latitude, 245]])),
      ].map((line) => line.setStyle({ color: '#618d8c', weight: 1, opacity: 0.2, dashArray: '2 6', interactive: false }))).addTo(map)
      for (const [latitude, longitude, label] of russianSeas) {
        L.marker([latitude, longitude], {
          interactive: false, keyboard: false,
          icon: L.divIcon({ className: 'atlas-sea', html: label, iconSize: [124, 16], iconAnchor: [62, 8] }),
        }).addTo(map)
      }
    }

    const coordsToLatLng = ([longitude, latitude]) =>
      L.latLng(latitude, russia && longitude < 0 ? longitude + 360 : longitude)
    const catalog = new Map(objects.map((object) => [object.id, object]))
    const summitMarkers = []
    // Water features stay selectable where rivers and lakes cross a mountain area.
    const mapObjects = political ? objects : [
      ...objects.filter((object) => object.kind === 'mountain'),
      ...objects.filter((object) => object.kind === 'river'),
      ...objects.filter((object) => object.kind === 'lake'),
    ]
    for (const object of mapObjects) {
      const style = political ? {
        color: '#647b74', weight: 0.7, fillColor: countryColors[object.color - 1] ?? '#e5e7cb',
        fillOpacity: 1, smoothFactor: 0,
      } : object.kind === 'mountain' || object.centerline ? invisibleArea : waterStyle
      if (object.centerline) {
        L.geoJSON(object.centerline, {
          coordsToLatLng, interactive: false, style: { color: '#3b86ab', weight: 1.35, opacity: 0.9 },
        }).addTo(map)
      }
      L.geoJSON(object.geometry, { style, coordsToLatLng }).eachLayer((layer) => {
        layer.addTo(map)
        const path = layer.getElement()
        path.dataset.objectId = object.id
        path.classList.add(political ? 'country-area' : 'physical-area')
      })
      if (object.summit) {
        summitMarkers.push(L.marker(coordsToLatLng(object.summit.coordinates), {
          interactive: false, keyboard: false,
          icon: L.divIcon({
            className: 'atlas-summit', iconSize: [10, 10], iconAnchor: [5, 6],
            html: `<span class="summit-symbol"></span><span class="summit-elevation">${formatElevation.format(object.summit.elevation)}</span>`,
          }),
        }).addTo(map))
      }
    }
    const arrangeSummitLabels = () => {
      const visible = []
      for (const marker of summitMarkers) {
        const point = map.latLngToLayerPoint(marker.getLatLng())
        const overlaps = visible.some((other) => Math.abs(other.x - point.x) < 44 && Math.abs(other.y - point.y) < 14)
        marker.getElement().classList.toggle('summit-label-overlaps', overlaps)
        if (!overlaps) visible.push(point)
      }
    }
    arrangeSummitLabels()
    map.on('zoomend', arrangeSummitLabels)
    const outline = L.geoJSON(null, { style: outlineStyle, coordsToLatLng, interactive: false }).addTo(map)
    const pin = L.circleMarker([0, 0], {
      radius: 7, color: '#fff', weight: 3, fillColor: '#17463c', fillOpacity: 1, interactive: false,
    })
    mapState.current = { map, reset, catalog, outline, pin }
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map)

    let pointerType = ''
    let touches = 0
    let multiTouch = false
    let lastTouch = null
    const pointerDown = (event) => {
      pointerType = event.pointerType
      lastTouch = null
      if (pointerType === 'touch') hovered.current = null
    }
    const touchStart = (event) => {
      if (touches === 0) multiTouch = false
      touches = event.touches.length
      if (touches > 1) multiTouch = true
    }
    const touchEnd = (event) => {
      touches = event.touches.length
      if (!russia && event.type === 'touchend' && !multiTouch) {
        lastTouch = event.changedTouches[0]
      }
    }
    const click = ({ originalEvent, latlng }) => {
      const input = originalEvent.pointerType || pointerType
      const touch = input === 'touch' || input === 'pen'
      if (touch && multiTouch) return
      // The browser can move a synthesized click to a nearby country on touch screens.
      if (touch && lastTouch) {
        const hit = objectAt(document.elementFromPoint(lastTouch.clientX, lastTouch.clientY))
        choosePoint(hit, map.mouseEventToLatLng(lastTouch), true)
        lastTouch = null
      } else {
        choosePoint(objectAt(originalEvent.target), latlng, touch)
      }
    }
    const clearHover = () => {
      hovered.current = null
      setInspected(null)
      paintOutline()
    }
    const pointerMove = (event) => {
      if (event.pointerType === 'touch' || event.buttons) return
      const hit = objectAt(event.target)
      if (hit === hovered.current) return
      hovered.current = hit
      inspect(hit)
      paintOutline()
    }
    const keyDown = (event) => {
      if (event.key === 'Escape') {
        setInspected(null)
        return
      }
      if (event.key !== 'Enter' || event.target !== container) return
      event.preventDefault()
      const { left, top, width, height } = container.getBoundingClientRect()
      const hit = objectAt(document.elementFromPoint(left + width / 2, top + height / 2))
      choosePoint(hit, map.getCenter(), true)
    }
    container.addEventListener('pointerdown', pointerDown)
    container.addEventListener('pointermove', pointerMove)
    container.addEventListener('pointerleave', clearHover)
    container.addEventListener('touchstart', touchStart, { passive: true })
    container.addEventListener('touchend', touchEnd, { passive: true })
    container.addEventListener('touchcancel', touchEnd, { passive: true })
    document.addEventListener('keydown', keyDown)
    map.on('click', click).on('movestart', clearHover)

    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false, animate: false }))
    observer.observe(container)
    return () => {
      observer.disconnect()
      container.removeEventListener('pointerdown', pointerDown)
      container.removeEventListener('pointermove', pointerMove)
      container.removeEventListener('pointerleave', clearHover)
      container.removeEventListener('touchstart', touchStart)
      container.removeEventListener('touchend', touchEnd)
      container.removeEventListener('touchcancel', touchEnd)
      document.removeEventListener('keydown', keyDown)
      map.off('movestart', clearHover)
      map.remove()
      mapState.current = null
    }
  }, [atlas, config, objects, political, russia])

  useEffect(() => {
    setInspected(null)
    hovered.current = null
    if (taskNumber !== 1) mapState.current.reset()
    paintOutline()
  }, [taskNumber])

  useEffect(() => {
    const { map, pin, outline } = mapState.current
    if (marker) {
      const longitude = marker.displayLongitude ?? marker.longitude
      const nearbyLongitude = russia
        ? longitude + 360 * Math.round((map.getCenter().lng - longitude) / 360)
        : longitude
      pin.setLatLng([marker.latitude, nearbyLongitude])
        .setStyle({ fillColor: feedback && !feedback.correct ? '#af4a23' : '#17463c' })
        .addTo(map)
    } else {
      pin.remove()
    }
    paintOutline()
    if (feedback && !feedback.correct) {
      const target = outline.getBounds()
      const size = map.project(target.getSouthEast()).subtract(map.project(target.getNorthWest()))
      if (!map.getBounds().pad(-0.12).contains(target) || Math.max(size.x, size.y) < 30) {
        map.fitBounds(target, { padding: [70, 70], maxZoom: 12, animate: false })
      }
    }
  }, [marker, highlight, feedback, russia])

  return (
    <section className="map-card" aria-label={political ? 'Политическая карта' : 'Физическая карта'}>
      <div className={`map-frame ${training ? 'answer-map' : ''}`}>
        <div
          className={`map-canvas${political ? ' political-map' : ''}`}
          ref={element}
          aria-label={russia ? 'Интерактивная карта России' : 'Интерактивная карта мира'}
          aria-describedby={!training && inspected ? 'keyboard-guide map-tooltip' : 'keyboard-guide'}
        />
        <span id="keyboard-guide" className="sr-only">Стрелки перемещают карту. Enter выбирает точку в центре карты.</span>
        <div className="map-tooltip-placement" aria-live="polite">
          {!training && inspected && <ObjectTooltip object={inspected} />}
        </div>
        <div className="map-north" aria-hidden="true"><span>С</span><span>▲</span></div>
        <div className="map-crosshair" aria-hidden="true"><Crosshair size={27} /></div>
        <div className="map-controls" aria-label="Управление картой">
          <div className="zoom-controls">
            <button className="icon-button" aria-label="Приблизить" onClick={() => mapState.current.map.zoomIn()}><Plus size={21} /></button>
            <button className="icon-button" aria-label="Отдалить" onClick={() => mapState.current.map.zoomOut()}><Minus size={21} /></button>
          </div>
          <button className="icon-button reset-map" aria-label="Показать всю карту" onClick={() => mapState.current.reset()}><Crosshair size={20} /></button>
        </div>
      </div>
      <div className="map-footer">
        <div className="map-legend" aria-label="Условные обозначения">
          {political ? <span><i className="legend-country" /> Границы стран</span> : (
            <>
              <span><i className="legend-relief" /> Равнины и горы</span>
              <span><i className="legend-river" /> Реки</span>
              <span><i className="legend-water" /> Озёра</span>
              <span><i className="summit-symbol" /> Высшие точки</span>
              <span><i className="legend-boundary" /> Граница</span>
            </>
          )}
        </div>
        <div className="attribution">
          {config.attributions.map(({ text, url }) => <a key={url} href={url} target="_blank" rel="noreferrer">{text}</a>)}
        </div>
      </div>
    </section>
  )
}
