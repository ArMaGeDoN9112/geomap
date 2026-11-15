import { lazy, Suspense, useEffect, useEffectEvent, useRef, useState } from 'react'
import L from 'leaflet'
import { MapControls, MapInspection, countryColors, mappedObjects, physicalMapColors } from './mapPresentation'

const waterStyle = {
  stroke: false, fillColor: physicalMapColors.water, fillOpacity: 1, smoothFactor: 0,
}
const invisibleArea = { stroke: false, fill: true, fillOpacity: 0, smoothFactor: 0 }
const outlineStyle = { color: '#125b50', weight: 3, fillColor: '#91d5ae', fillOpacity: 0.6, smoothFactor: 0, interactive: false }
const physicalOutline = { ...outlineStyle, weight: 2, fill: false }
const missedStyle = { ...outlineStyle, color: '#af4a23', fillColor: '#ef9e67', fillOpacity: 0.72 }
const missedPhysicalOutline = { ...physicalOutline, color: missedStyle.color, weight: 3 }
const formatElevation = new Intl.NumberFormat('ru-RU')
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

function FlatMap({ atlas, political, taskNumber, highlight, marker, feedback, onSelect, controlsTarget }) {
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
      const overview = { alt: '', pane: 'tilePane', zIndex: 0 }
      L.imageOverlay('/flat-satellite.jpg', [[-limit, -180], [limit, 180]], overview).addTo(map)
      if (russia) L.imageOverlay('/flat-satellite.jpg', [[-limit, 180], [limit, 540]], overview).addTo(map)
      L.tileLayer('https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg', {
        minZoom: 5, maxZoom: 16, maxNativeZoom: 14, updateWhenIdle: true,
      }).addTo(map)
    }
    if (atlas.lines) {
      const lineStyle = ({ properties }) => properties.kind === 'boundary'
        ? (political
          ? { color: '#5b5153', weight: 1, opacity: 0.63, dashArray: '4 4' }
          : { color: physicalMapColors.boundary, weight: 1 })
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
    for (const object of mappedObjects(objects, political)) {
      const style = political ? {
        color: '#647b74', weight: 0.7, fillColor: countryColors[object.color - 1] ?? '#e5e7cb',
        fillOpacity: 1, smoothFactor: 0,
      } : object.kind === 'mountain' || object.centerline ? invisibleArea : waterStyle
      if (object.centerline) {
        L.geoJSON(object.centerline, {
          coordsToLatLng, interactive: false, style: { color: physicalMapColors.river, weight: 1.35 },
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
    <>
      <div
        className={`map-canvas ${political ? 'political-map' : 'satellite-map'}`}
        ref={element}
        aria-label={russia ? 'Интерактивная карта России' : 'Интерактивная карта мира'}
        aria-describedby={!training && inspected ? 'keyboard-guide map-tooltip' : 'keyboard-guide'}
      />
      <span id="keyboard-guide" className="sr-only">Стрелки перемещают карту. Enter выбирает точку в центре карты.</span>
      <MapInspection object={!training && inspected} />
      <div className="map-north" aria-hidden="true"><span>С</span><span>▲</span></div>
      <MapControls
        zoomIn={() => mapState.current.map.zoomIn()}
        zoomOut={() => mapState.current.map.zoomOut()}
        reset={() => mapState.current.reset()}
        target={controlsTarget}
      />
    </>
  )
}

function GlobeLoadError() {
  return <p className="globe-status" role="alert">Не удалось открыть глобус. Выбери 2D.</p>
}

const GlobeView = lazy(() => import('./GlobeView').catch(() => ({ default: GlobeLoadError })))

export function MapView({ globe, ...props }) {
  const { political, atlas, taskNumber } = props
  return (
    <section className="map-card" aria-label={political ? 'Политическая карта' : 'Физическая карта'}>
      <div className={`map-frame ${taskNumber !== undefined ? 'answer-map' : ''}`}>
        {globe ? (
          <Suspense fallback={<p className="globe-status" role="status">Загружаем глобус…</p>}>
            <GlobeView {...props} />
          </Suspense>
        ) : <FlatMap {...props} />}
      </div>
      <div className="map-footers">
        <MapFooter atlas={atlas} political={political} globe={false} active={!globe} />
        <MapFooter atlas={atlas} political={political} globe active={globe} />
      </div>
    </section>
  )
}

function MapFooter({ atlas, political, globe, active }) {
  return (
    <div className="map-footer" aria-hidden={active ? undefined : true}>
      <div className="map-legend" aria-label="Условные обозначения">
        {political ? <span><i className="legend-country" /> Границы стран</span> : (
          <>
            <span><i className="legend-relief" /> Равнины и горы</span>
            <span><i className="legend-river" /> Реки</span>
            <span><i className="legend-water" /> Озёра</span>
            {!globe && <span><i className="summit-symbol" /> Высшие точки</span>}
            <span><i className="legend-boundary" /> Граница</span>
          </>
        )}
      </div>
      <div className="attribution">
        {atlas.list.map.attributions.map(({ text, url }) => <a key={url} href={url} target="_blank" rel="noreferrer">{text}</a>)}
        {globe && <a href="https://www.ncei.noaa.gov/products/etopo-global-relief-model" target="_blank" rel="noreferrer">NOAA ETOPO 2022</a>}
        {!political && (
          <a href="https://cloudless.eox.at/" target="_blank" rel="noreferrer">
            EOxCloudless by EOX IT Services GmbH · modified Copernicus Sentinel data 2016 &amp; 2017
          </a>
        )}
      </div>
    </div>
  )
}
