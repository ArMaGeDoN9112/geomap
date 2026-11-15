import { useEffect, useEffectEvent, useRef, useState } from 'react'
import L from 'leaflet'
import { Crosshair, Minus, Plus } from 'lucide-react'

const waterStyle = {
  color: '#467e8e', weight: 1, fillColor: '#6fa2b8', fillOpacity: 0.86, smoothFactor: 0,
}
const countryColors = [
  '#e6c994', '#b9d7ae', '#edc2ab', '#b7c8e2', '#e2dca1', '#d5bfdf', '#a9d5cc',
  '#ecc5cf', '#c7d6a4', '#f0d7aa', '#bcc8df', '#e4bca1', '#c6dcd6',
]
const outlineStyle = { color: '#125b50', weight: 3, fillColor: '#91d5ae', fillOpacity: 0.6, smoothFactor: 0, interactive: false }
const missedStyle = { ...outlineStyle, color: '#af4a23', fillColor: '#ef9e67', fillOpacity: 0.72 }

function objectAt(element) {
  return element?.closest?.('[data-object-id]')?.dataset.objectId
}

export function MapView({ atlas, political, taskNumber, highlight, marker, feedback, onSelect }) {
  const element = useRef(null)
  const mapState = useRef(null)
  const hovered = useRef(null)
  const [tilesMissing, setTilesMissing] = useState(false)
  const { map: config, objects } = atlas.list
  const training = taskNumber !== undefined

  const inspect = useEffectEvent((hit, position) => {
    const { map, tooltip, catalog } = mapState.current
    if (!training && hit) {
      const object = catalog.get(hit)
      const label = document.createElement('div')
      label.textContent = object.name
      if (object.capitals?.length) {
        const capitals = document.createElement('small')
        capitals.textContent = `${object.capitals.length === 1 ? 'Столица' : 'Столицы'} · ${object.capitals.join(', ')}`
        label.append(capitals)
      }
      tooltip.setContent(label).setLatLng(position).openOn(map)
    } else {
      tooltip.remove()
    }
  })

  const paintOutline = useEffectEvent(() => {
    const { outline, catalog } = mapState.current
    const id = feedback && !feedback.correct
      ? feedback.object_id
      : highlight && (hovered.current || (marker?.needsConfirmation && marker.objectId))
    const style = feedback ? missedStyle : outlineStyle
    if (outline.id === id && outline.options.style === style) return
    outline.id = id
    outline.options.style = style
    outline.clearLayers()
    if (id) outline.addData(catalog.get(id).geometry)
  })

  const choosePoint = useEffectEvent((hit, position, confirm) => {
    if (training) {
      if (political && (position.lng < -180 || position.lng > 180)) return
      const { lat, lng } = political ? position : position.wrap()
      onSelect({ latitude: lat, longitude: lng, displayLongitude: position.lng, objectId: hit, needsConfirmation: confirm })
    } else {
      inspect(hit, position)
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
      minZoom: political ? 0 : 1,
      maxZoom: 18,
      maxBounds: political ? [[-85.05, -180], [85.05, 180]] : [[15, -72], [85.05, 245]],
      maxBoundsViscosity: 1,
      zoomAnimation: false,
      fadeAnimation: false,
    })
    const reset = () => map.fitBounds(bounds, { padding: [political ? 10 : 22, 22], animate: false })
    reset()

    if (!political) {
      map.createPane('land').style.zIndex = 190
      L.rectangle([[-90, -540], [90, 540]], {
        pane: 'land', interactive: false, stroke: false, fillColor: '#cadee2', fillOpacity: 1,
      }).addTo(map)
      L.geoJSON(atlas.land, {
        pane: 'land', interactive: false, stroke: false, fillColor: '#e5e7cb', fillOpacity: 1,
      }).addTo(map)
      L.tileLayer(config.hillshade_tiles, { maxNativeZoom: config.hillshade_max_zoom })
        .on('loading', () => setTilesMissing(false))
        .on('tileerror', () => setTilesMissing(true))
        .addTo(map)

      const lineStyle = ({ properties }) => properties.kind === 'boundary'
        ? { color: '#657c62', weight: 1.05, opacity: 0.62, dashArray: '4 4' }
        : { color: '#789a96', weight: 1, opacity: 0.75 }
      L.geoJSON(atlas.lines, { style: lineStyle, interactive: false }).addTo(map)
      L.geoJSON(atlas.lines, {
        style: lineStyle, interactive: false,
        coordsToLatLng: ([longitude, latitude]) => L.latLng(latitude, longitude + 360),
      }).addTo(map)
      L.layerGroup([
        ...[30, 60, 90, 120, 150, 180, 210].map((longitude) => L.polyline([[15, longitude], [85, longitude]])),
        ...[30, 45, 60, 75].map((latitude) => L.polyline([[latitude, -72], [latitude, 245]])),
      ].map((line) => line.setStyle({ color: '#618d8c', weight: 1, opacity: 0.2, dashArray: '2 6', interactive: false }))).addTo(map)
    }

    const catalog = new Map(objects.map((object) => [object.id, object]))
    for (const object of objects) {
      const style = political ? {
        color: '#647b74', weight: 0.7, fillColor: countryColors[object.color - 1] ?? '#e5e7cb',
        fillOpacity: 1, smoothFactor: 0,
      } : waterStyle
      L.geoJSON(object.geometry, { style }).eachLayer((layer) => {
        layer.addTo(map)
        const path = layer.getElement()
        path.dataset.objectId = object.id
        path.classList.add(political ? 'country-area' : 'water-area')
      })
    }
    const outline = L.geoJSON(null, { style: outlineStyle, interactive: false }).addTo(map)
    const pin = L.circleMarker([0, 0], {
      radius: 7, color: '#fff', weight: 3, fillColor: '#17463c', fillOpacity: 1, interactive: false,
    })
    const tooltip = L.tooltip({ direction: 'top', offset: [0, -10] })
    mapState.current = { map, reset, catalog, outline, pin, tooltip }
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
      if (political && event.type === 'touchend' && !multiTouch) {
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
      tooltip.remove()
      paintOutline()
    }
    const pointerMove = (event) => {
      if (event.pointerType === 'touch' || event.buttons) return
      const hit = objectAt(event.target)
      if (hit === hovered.current) return
      hovered.current = hit
      inspect(hit, map.mouseEventToLatLng(event))
      paintOutline()
    }
    const keyDown = (event) => {
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
    container.addEventListener('keydown', keyDown)
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
      container.removeEventListener('keydown', keyDown)
      map.off('movestart', clearHover)
      map.remove()
      mapState.current = null
    }
  }, [atlas, config, objects, political])

  useEffect(() => {
    mapState.current.tooltip.remove()
    hovered.current = null
    if (taskNumber !== 1) mapState.current.reset()
    paintOutline()
  }, [taskNumber])

  useEffect(() => {
    const { map, pin, outline } = mapState.current
    if (marker) {
      const longitude = marker.displayLongitude ?? marker.longitude
      const nearbyLongitude = political
        ? longitude
        : longitude + 360 * Math.round((map.getCenter().lng - longitude) / 360)
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
  }, [marker, highlight, feedback, political])

  return (
    <section className="map-card" aria-label={political ? 'Политическая карта' : 'Физическая карта'}>
      <div className={`map-frame ${training ? 'answer-map' : ''}`}>
        <div
          className={`map-canvas${political ? ' political-map' : ''}`}
          ref={element}
          aria-label={political ? 'Интерактивная карта мира' : 'Интерактивная карта России'}
          aria-describedby="keyboard-guide"
        />
        <span id="keyboard-guide" className="sr-only">Стрелки перемещают карту. Enter выбирает точку в центре карты.</span>
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
        {tilesMissing && <p className="tile-note">Часть тайлов рельефа может быть недоступна.</p>}
        <div className="map-legend" aria-label="Условные обозначения">
          {political ? <span><i className="legend-country" /> Границы стран</span> : (
            <>
              <span><i className="legend-water" /> Акватория</span>
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
