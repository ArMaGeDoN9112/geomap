import { CanvasTexture, LinearFilter, SRGBColorSpace, Vector4 } from 'three'

const endpoint = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless/default/WGS84'
const tileSize = 256
const budget = 56

function tilePlan(bounds, pixelWidth, pixelHeight, maxTextureSize) {
  const { west, north, east, south } = bounds
  const pixels = Math.max(pixelWidth / (east - west), 2 * pixelHeight / (south - north))
  const preferred = Math.min(13, Math.round(Math.log2(pixels / (2 * tileSize))))
  for (let level = preferred; level >= 4; level--) {
    const rows = 2 ** level
    const columns = 2 * rows
    const left = Math.floor((west - (east - west) * 0.08) * columns)
    const right = Math.ceil((east + (east - west) * 0.08) * columns)
    const top = Math.max(0, Math.floor((north - (south - north) * 0.08) * rows))
    const bottom = Math.min(rows, Math.ceil((south + (south - north) * 0.08) * rows))
    const width = right - left, height = bottom - top
    if (width * height > budget || Math.max(width, height) * tileSize > maxTextureSize) continue
    return { level, rows, columns, left, top, width, height, key: [level, left, top, width, height].join('/') }
  }
  return null
}

export function globeImagery(material, drawAtlas, redraw, maxTextureSize) {
  const imagery = document.createElement('canvas')
  const output = document.createElement('canvas')
  const context = output.getContext('2d')
  const satelliteMap = { value: null }
  const bounds = { value: new Vector4() }
  const visible = { value: false }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      satelliteMap, satelliteBounds: bounds, satelliteVisible: visible,
    })
    shader.fragmentShader = `
      uniform sampler2D satelliteMap;
      uniform vec4 satelliteBounds;
      uniform bool satelliteVisible;
      ${shader.fragmentShader}
    `.replace('#include <opaque_fragment>', `
      if (satelliteVisible) {
        // Wrap the longitude around the center of the tile mosaic.
        vec2 offset = vec2(fract(vMapUv.x - satelliteBounds.x + 0.5) - 0.5,
          1.0 - vMapUv.y - satelliteBounds.y);
        vec2 imageUv = offset / satelliteBounds.zw + 0.5;
        vec2 edge = min(imageUv, 1.0 - imageUv);
        float blend = smoothstep(0.0, 0.014, min(edge.x, edge.y));
        if (blend > 0.0) {
          vec4 satellite = texture2D(satelliteMap, imageUv);
          outgoingLight = mix(outgoingLight, satellite.rgb, satellite.a * blend);
        }
      }
      #include <opaque_fragment>
    `)
  }

  const cache = new Map()
  let requested = null
  let shown = null
  let request = null
  let timer
  let outline = null
  let missed = false
  let drawOutline

  function paint() {
    context.clearRect(0, 0, output.width, output.height)
    context.drawImage(imagery, 0, 0)
    context.globalCompositeOperation = 'source-atop'
    drawOutline(context, outline, missed)
    context.globalCompositeOperation = 'source-over'
    satelliteMap.value.needsUpdate = true
  }

  async function load(plan, signal) {
    const canvas = document.createElement('canvas')
    canvas.width = plan.width * tileSize
    canvas.height = plan.height * tileSize
    const tiles = canvas.getContext('2d')
    const networkSignal = AbortSignal.any([signal, AbortSignal.timeout(12_000)])
    let next = 0
    let loaded = 0
    async function worker() {
      while (!networkSignal.aborted && next < plan.width * plan.height) {
        const index = next++
        const dx = index % plan.width
        const dy = Math.floor(index / plan.width)
        const x = (plan.left + dx + plan.columns) % plan.columns
        const url = `${endpoint}/${plan.level}/${plan.top + dy}/${x}.jpg`
        let tile = cache.get(url)
        if (!tile) {
          try {
            const response = await fetch(url, { signal: networkSignal })
            if (!response.ok) continue
            tile = await createImageBitmap(await response.blob())
            if (signal.aborted) {
              tile.close()
              return
            }
            cache.set(url, tile)
            if (cache.size > 160) {
              const oldest = cache.keys().next().value
              cache.get(oldest).close()
              cache.delete(oldest)
            }
          } catch {
            continue
          }
        }
        tiles.drawImage(tile, dx * tileSize, dy * tileSize, tileSize, tileSize)
        loaded++
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker))
    if (signal.aborted || !loaded) return

    if (!satelliteMap.value || output.width !== canvas.width || output.height !== canvas.height) {
      satelliteMap.value?.dispose()
      output.width = imagery.width = canvas.width
      output.height = imagery.height = canvas.height
      const texture = new CanvasTexture(output)
      texture.colorSpace = SRGBColorSpace
      texture.flipY = false
      texture.generateMipmaps = false
      texture.minFilter = LinearFilter
      satelliteMap.value = texture
    }
    const base = imagery.getContext('2d')
    base.globalCompositeOperation = 'source-over'
    base.clearRect(0, 0, imagery.width, imagery.height)
    base.drawImage(canvas, 0, 0)
    base.globalCompositeOperation = 'source-atop'
    drawOutline = drawAtlas(base, plan)
    bounds.value.set((plan.left + plan.width / 2) / plan.columns, (plan.top + plan.height / 2) / plan.rows,
      plan.width / plan.columns, plan.height / plan.rows)
    shown = plan.key
    visible.value = true
    paint()
    redraw()
  }

  return {
    update(area, width, height) {
      const plan = area && tilePlan(area, width, height, maxTextureSize)
      const key = plan?.key ?? null
      if (key === requested) return
      requested = key
      clearTimeout(timer)
      request?.abort()
      const wasVisible = visible.value
      visible.value = Boolean(plan && shown)
      if (!wasVisible && visible.value) paint()
      if (!plan || key === shown) return
      const controller = new AbortController()
      request = controller
      timer = setTimeout(() => load(plan, controller.signal), 130)
    },
    outline(geometry, isMissed) {
      outline = geometry
      missed = isMissed
      if (visible.value) paint()
    },
    dispose() {
      clearTimeout(timer)
      request?.abort()
      for (const tile of cache.values()) tile.close()
      satelliteMap.value?.dispose()
    },
  }
}
