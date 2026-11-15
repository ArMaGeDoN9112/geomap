import { Crosshair, Minus, Plus } from 'lucide-react'

export const countryColors = [
  '#e6c994', '#b9d7ae', '#edc2ab', '#b7c8e2', '#e2dca1', '#d5bfdf', '#a9d5cc',
  '#ecc5cf', '#c7d6a4', '#f0d7aa', '#bcc8df', '#e4bca1', '#c6dcd6',
]
const formatPopulation = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 })
const formatElevation = new Intl.NumberFormat('ru-RU')
const physicalKinds = { river: 'Река', lake: 'Озеро', mountain: 'Горный массив' }

export function mappedObjects(objects, political) {
  // Water features stay selectable where rivers and lakes cross a mountain area.
  return political ? objects : [
    ...objects.filter((object) => object.kind === 'mountain'),
    ...objects.filter((object) => object.kind === 'river'),
    ...objects.filter((object) => object.kind === 'lake'),
  ]
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

export function MapInspection({ object }) {
  return (
    <div className="map-tooltip-placement" aria-live="polite">
      {object && <ObjectTooltip object={object} />}
    </div>
  )
}

export function MapControls({ zoomIn, zoomOut, reset }) {
  return (
    <>
      <div className="map-crosshair" aria-hidden="true"><Crosshair size={27} /></div>
      <div className="map-controls" aria-label="Управление картой">
        <div className="zoom-controls">
          <button className="icon-button" aria-label="Приблизить" onClick={zoomIn}><Plus size={21} /></button>
          <button className="icon-button" aria-label="Отдалить" onClick={zoomOut}><Minus size={21} /></button>
        </div>
        <button className="icon-button reset-map" aria-label="Показать всю карту" onClick={reset}><Crosshair size={20} /></button>
      </div>
    </>
  )
}
