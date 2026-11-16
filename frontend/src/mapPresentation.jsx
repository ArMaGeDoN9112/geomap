import { createPortal } from 'react-dom'
import { Crosshair, Minus, Plus } from 'lucide-react'

export const physicalMapColors = { boundary: '#fff5ddae', river: '#73bfd4', water: '#82bad266' }
export const studyKinds = {
  mountain: 'Горы', river: 'Реки', lake: 'Озёра', sea: 'Моря', ocean: 'Океаны',
  island: 'Острова', peninsula: 'Полуострова', strait: 'Проливы', bay: 'Заливы',
  plain: 'Равнины', upland: 'Возвышенности', landmark: 'Ориентиры',
}
export const defaultStudyHighlights = ['river', 'lake']
const landOutline = { color: '#ffd88b', weight: 2, fill: false }
const waterArea = { color: '#93dcf9', weight: 1.25, fillColor: '#57bbec', fillOpacity: 0.25 }
export const studyAreaStyles = {
  mountain: landOutline, island: landOutline, peninsula: landOutline, plain: landOutline,
  upland: landOutline, landmark: landOutline, summit: landOutline,
  sea: waterArea, bay: waterArea, strait: waterArea,
  ocean: { stroke: false, fillColor: '#518bde', fillOpacity: 0.19 },
}

export function isMarine(object) {
  return object.kind === 'sea' || object.kind === 'ocean'
}

export const countryColors = [
  '#e6c994', '#b9d7ae', '#edc2ab', '#b7c8e2', '#e2dca1', '#d5bfdf', '#a9d5cc',
  '#ecc5cf', '#c7d6a4', '#f0d7aa', '#bcc8df', '#e4bca1', '#c6dcd6',
]
const formatPopulation = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 })
const formatElevation = new Intl.NumberFormat('ru-RU')
const physicalKinds = {
  river: 'Река', lake: 'Озеро', mountain: 'Горный массив', sea: 'Море', ocean: 'Океан',
  island: 'Острова и архипелаги', peninsula: 'Полуостров', strait: 'Пролив', bay: 'Залив',
  plain: 'Равнина или плоскогорье', upland: 'Возвышенность', landmark: 'Ориентир', summit: 'Вершина',
}

export function mappedObjects({ objects, marine = [] }, political) {
  if (political) return objects
  // Draw smaller features over the surrounding areas so they stay selectable.
  const order = ['ocean', 'sea', 'plain', 'peninsula', 'island', 'mountain', 'upland', 'bay', 'strait', 'river', 'lake', 'landmark']
  const features = [...marine, ...objects]
  const markedSummits = new Set(objects.filter((object) => object.kind === 'mountain').map((object) => object.summit?.id))
  return order.flatMap((kind) => features.filter((object) =>
    object.kind === kind || (kind === 'mountain' && object.kind === 'summit' && object.summit && !markedSummits.has(object.id))
  ))
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
      ) : physicalKinds[object.kind] && (
        <p>{physicalKinds[object.kind]}{object.region && ` · ${object.region}`}</p>
      )}
      {object.summit && (
        <p>Высшая точка · {object.summit.name}, {formatElevation.format(object.summit.elevation)} м</p>
      )}
      {object.related_peak && <p>Вершина в списке · {object.related_peak}</p>}
    </div>
  )
}

export function MapInspection({ object }) {
  return (
    <div className="map-tooltip-placement" aria-live="polite">
      {object && <ObjectTooltip object={object} />}
    </div>
  )
}

export function MapControls({ zoomIn, zoomOut, reset, target }) {
  const buttons = (
    <div className="map-controls" role="group" aria-label="Управление картой">
      <div className="zoom-controls">
        <button className="icon-button" aria-label="Приблизить" onClick={zoomIn}><Plus size={21} /></button>
        <button className="icon-button" aria-label="Отдалить" onClick={zoomOut}><Minus size={21} /></button>
      </div>
      <button className="icon-button reset-map" aria-label="Показать всю карту" onClick={reset}><Crosshair size={20} /></button>
    </div>
  )
  return target ? createPortal(buttons, target) : buttons
}
