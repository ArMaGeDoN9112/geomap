import {
  AmbientLight, CanvasTexture, DirectionalLight, DoubleSide, Mesh, MeshLambertMaterial,
  PerspectiveCamera, Raycaster, Scene, SphereGeometry, SRGBColorSpace, Vector2, Vector3, WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh'
import { countryColors, mappedObjects, physicalMapColors } from './mapPresentation'
import { globeImagery } from './globeImagery'

const gridWidth = 1440
const gridHeight = 720
const terrainScale = 40 / 6_371_000
const radians = Math.PI / 180

export async function loadElevation(signal) {
  const response = await fetch('/etopo-2022.i16', { signal })
  if (!response.ok) throw new Error('Could not load ETOPO')
  const grid = new DataView(await response.arrayBuffer())
  if (grid.byteLength !== gridWidth * gridHeight * 2) throw new Error('Invalid ETOPO grid size')
  return grid
}

function elevationAt(grid, u, v) {
  const x = u * gridWidth - 0.5
  const y = Math.max(0, Math.min(gridHeight - 1, v * gridHeight - 0.5))
  const left = Math.floor(x), top = Math.floor(y)
  const tx = x - left, ty = y - top
  const read = (column, row) => grid.getInt16(2 * (row * gridWidth + (column + gridWidth) % gridWidth), true)
  const row = (index) => read(left, index) * (1 - tx) + read(left + 1, index) * tx
  return row(top) * (1 - ty) + row(Math.min(top + 1, gridHeight - 1)) * ty
}

function makeTerrain(grid) {
  // shortcut: half-degree mesh for an overview, use terrain tiles for local detail.
  const geometry = new SphereGeometry(1, 720, 360)
  const { position, uv } = geometry.attributes
  for (let index = 0; index < position.count; index++) {
    const v = 1 - uv.getY(index)
    const u = v === 0 || v === 1 ? 0.5 : uv.getX(index)
    const radius = 1 + elevationAt(grid, u, v) * terrainScale
    position.setXYZ(index, position.getX(index) * radius, position.getY(index) * radius, position.getZ(index) * radius)
  }
  geometry.computeVertexNormals()
  const { normal } = geometry.attributes
  const sum = new Vector3(), other = new Vector3()
  for (let row = 1; row < 360; row++) {
    const first = row * 721, last = first + 720
    sum.fromBufferAttribute(normal, first).add(other.fromBufferAttribute(normal, last)).normalize()
    normal.setXYZ(first, sum.x, sum.y, sum.z)
    normal.setXYZ(last, sum.x, sum.y, sum.z)
  }
  geometry.boundsTree = new MeshBVH(geometry)
  return geometry
}

function surfacePoint(longitude, latitude) {
  const horizontal = Math.cos(latitude * radians)
  return new Vector3(horizontal * Math.cos(longitude * radians), Math.sin(latitude * radians),
    -horizontal * Math.sin(longitude * radians))
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas.getContext('2d')
}

function paintTerrain(context, image, grid) {
  const { width, height } = context.canvas
  const mercatorY = (latitude) => {
    const angle = Math.max(-85.05112878, Math.min(85.05112878, latitude)) * radians
    return image.height * (0.5 - Math.asinh(Math.tan(angle)) / (2 * Math.PI))
  }
  for (let row = 0; row < height; row++) {
    const y = Math.min(image.height - 1, Math.max(0, mercatorY(90 - (row + 0.5) * 180 / height)))
    context.drawImage(image, 0, y, image.width, 1, 0, row, width, 1)
  }

  // Tint the existing ocean pixels by depth while keeping the detailed Natural Earth coastline.
  const pixels = context.getImageData(0, 0, width, height)
  const data = pixels.data
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = 4 * (y * width + x)
      if (data[offset + 2] - data[offset] < 16) continue
      const depth = Math.min(1, Math.max(0, -elevationAt(grid, (x + 0.5) / width, (y + 0.5) / height) / 8500))
      data[offset] *= 1 - 0.67 * depth
      data[offset + 1] *= 1 - 0.46 * depth
      data[offset + 2] *= 1 - 0.30 * depth
    }
  }
  context.putImageData(pixels, 0, 0)
}

function ringsOf({ type, coordinates }) {
  if (type === 'MultiPolygon') return coordinates.flat()
  if (type === 'Polygon' || type === 'MultiLineString') return coordinates
  if (type === 'LineString') return [coordinates]
  return []
}

function mapPath(geometry, project, offsets = [0]) {
  const path = new Path2D()
  for (const offset of offsets) {
    for (const ring of ringsOf(geometry)) {
      for (let index = 0; index < ring.length; index++) {
        const [longitude, latitude] = ring[index]
        path[index === 0 ? 'moveTo' : 'lineTo'](...project(longitude + offset, latitude))
      }
    }
  }
  return path
}

function focusPoint({ type, coordinates }) {
  const rings = type === 'MultiPolygon' ? coordinates.map(([outer]) => outer) : [coordinates[0]]
  const largest = rings.reduce((best, ring) => {
    let west = 180, east = -180, south = 90, north = -90
    for (const [longitude, latitude] of ring) {
      west = Math.min(west, longitude)
      east = Math.max(east, longitude)
      south = Math.min(south, latitude)
      north = Math.max(north, latitude)
    }
    const area = (east - west) * (north - south)
    return area > best.area ? { area, longitude: (west + east) / 2, latitude: (south + north) / 2,
      span: Math.max(east - west, north - south) } : best
  }, { area: -1 })
  return largest
}

function paintAtlas(context, atlas, political, pathFor) {
  const objects = mappedObjects(atlas.list.objects, political)
    .map((object) => ({ object, path: pathFor(object.geometry) }))
  for (const { geometry, properties } of atlas.lines?.features ?? []) {
    if (!geometry) continue
    const boundary = properties?.kind === 'boundary' || political
    context.strokeStyle = boundary ? (political ? '#4e514fa0' : physicalMapColors.boundary) : '#547f8b80'
    context.lineWidth = 1
    context.stroke(pathFor(geometry))
  }
  for (const { object, path } of objects) {
    if (political) {
      context.globalAlpha = 0.57
      context.fillStyle = countryColors[object.color - 1] ?? '#e5e7cb'
      context.fill(path, 'evenodd')
      context.globalAlpha = 1
      context.strokeStyle = '#4b6764'
      context.lineWidth = 1
      context.stroke(path)
    } else if (object.centerline) {
      context.strokeStyle = physicalMapColors.river
      context.lineWidth = 1.25
      context.stroke(pathFor(object.centerline))
    } else if (object.kind === 'lake' || object.kind === 'river') {
      context.fillStyle = physicalMapColors.water
      context.fill(path, 'evenodd')
    }
  }
  return objects.reverse()
}

function strokeOutline(context, path, missed) {
  context.lineJoin = 'round'
  context.strokeStyle = '#fffdf2'
  context.lineWidth = 5
  context.stroke(path)
  context.strokeStyle = missed ? '#b74318' : '#125b50'
  context.lineWidth = 2.5
  context.stroke(path)
}

export function createGlobe(container, pinElement, atlas, political, grid, overview) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true })
  const width = Math.min(4096, renderer.capabilities.maxTextureSize)
  const base = makeCanvas(width, width / 2)
  if (political) paintTerrain(base, overview, grid)
  else base.drawImage(overview, 0, 0, width, width / 2)
  const pathFor = (geometry) => mapPath(geometry, (lon, lat) => [(lon + 180) * width / 360, (90 - lat) * width / 360])
  const objects = paintAtlas(base, atlas, political, pathFor)
  const paths = new Map(objects.map(({ object, path }) => [object.id, path]))
  const catalog = new Map(atlas.list.objects.map((object) => [object.id, object]))
  const paint = makeCanvas(width, width / 2)
  paint.drawImage(base.canvas, 0, 0)
  const texture = new CanvasTexture(paint.canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8)

  const scene = new Scene()
  const geometry = makeTerrain(grid)
  const material = new MeshLambertMaterial({ map: texture })
  const terrain = new Mesh(geometry, material)
  terrain.raycast = acceleratedRaycast
  scene.add(terrain, new AmbientLight(0xffffff, 1.6))
  const camera = new PerspectiveCamera(36, 1, 0.004, 30)
  const sun = new DirectionalLight(0xfff1dd, 2.2)
  sun.position.set(-3, 5, 4)
  camera.add(sun, sun.target)
  scene.add(camera)

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.domElement.setAttribute('aria-hidden', 'true')
  container.prepend(renderer.domElement)
  const controls = new OrbitControls(camera, container)
  controls.enablePan = false
  controls.minDistance = 1.075
  controls.maxDistance = 15
  const overviewRotationSpeed = 0.55
  const ray = new Raycaster()
  const pointer = new Vector2()
  ray.firstHitOnly = true
  let pin = null
  let outlined = null
  let missedOutline = false
  const imagery = political ? null : globeImagery(material, (context, plan) => {
    const { width: mosaicWidth, height: mosaicHeight } = context.canvas
    const offsets = [0]
    if (plan.left < 0) offsets.push(-360)
    if (plan.left + plan.width > plan.columns) offsets.push(360)
    const localPath = (shape) => mapPath(shape, (lon, lat) => [
      ((lon + 180) * plan.columns / 360 - plan.left) * mosaicWidth / plan.width,
      ((90 - lat) * plan.rows / 180 - plan.top) * mosaicHeight / plan.height,
    ], offsets)
    paintAtlas(context, atlas, political, localPath)
    return (target, shape, missed) => {
      if (shape) strokeOutline(target, localPath(shape), missed)
    }
  }, render, width)

  function hitAt(x, y) {
    ray.setFromCamera(pointer.set(x, y), camera)
    return ray.intersectObject(terrain)[0]
  }

  function visibleArea() {
    if (camera.position.length() > 1.6) return null
    const center = hitAt(0, 0)?.uv
    if (!center) return null
    let west = center.x, east = center.x, north = 1 - center.y, south = north
    for (const y of [-1, -0.5, 0, 0.5, 1]) {
      for (const x of [-1, -0.5, 0, 0.5, 1]) {
        const uv = hitAt(x, y)?.uv
        if (!uv) continue
        const longitude = uv.x - Math.round(uv.x - center.x)
        west = Math.min(west, longitude)
        east = Math.max(east, longitude)
        north = Math.min(north, 1 - uv.y)
        south = Math.max(south, 1 - uv.y)
      }
    }
    return east > west && south > north ? { west, east, north, south } : null
  }

  function viewChanged() {
    // A smaller angle keeps the terrain from rushing past the pointer at close range.
    controls.rotateSpeed = overviewRotationSpeed * Math.min(1, (camera.position.length() - 1) / 1.5)
    camera.updateMatrixWorld()
    imagery?.update(visibleArea(), renderer.domElement.width, renderer.domElement.height)
    render()
  }

  function render() {
    renderer.render(scene, camera)
    pinElement.hidden = true
    if (!pin) return
    const direction = pin.clone().sub(camera.position).normalize()
    ray.set(camera.position, direction)
    const visible = ray.intersectObject(terrain)[0]
    if (!visible || visible.point.distanceToSquared(pin) > 0.00001) return
    const screen = pin.clone().project(camera)
    if (Math.abs(screen.x) > 1 || Math.abs(screen.y) > 1) return
    pinElement.style.left = `${(screen.x + 1) * 50}%`
    pinElement.style.top = `${(1 - screen.y) * 50}%`
    pinElement.hidden = false
  }

  function resize() {
    const { clientWidth, clientHeight } = container
    if (!clientWidth || !clientHeight) return
    camera.aspect = clientWidth / clientHeight
    camera.updateProjectionMatrix()
    renderer.setSize(clientWidth, clientHeight, false)
    viewChanged()
  }

  function lookAt(longitude, latitude, distance) {
    camera.position.copy(surfacePoint(longitude, latitude).multiplyScalar(distance))
    controls.update()
    render()
  }

  function reset() {
    const [west, south, east, north] = atlas.list.map.bounds
    const angle = Math.atan(Math.tan(camera.fov * radians / 2) * Math.min(camera.aspect, 1))
    const distance = 1.04 / Math.sin(angle * 0.88)
    const world = atlas.category === 'world'
    lookAt(world ? 18 : (west + east) / 2, world ? 22 : (south + north) / 2, distance)
  }

  controls.addEventListener('change', viewChanged)
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(container)
  resize()
  reset()

  return {
    pick(x = 0, y = 0) {
      const hit = hitAt(x, y)
      if (!hit) return null
      const { x: u, y: v } = hit.uv
      const longitude = Math.max(-180, Math.min(180, u * 360 - 180))
      const latitude = Math.max(-90, Math.min(90, v * 180 - 90))
      const match = objects.find(({ path }) => paint.isPointInPath(path, u * width, (1 - v) * width / 2, 'evenodd'))
      return { longitude, latitude, object: match?.object }
    },
    outline(id, missed) {
      if (id === outlined && missed === missedOutline) return
      outlined = id
      missedOutline = missed
      paint.drawImage(base.canvas, 0, 0)
      const object = catalog.get(id)
      if (object) strokeOutline(paint, paths.get(id) ?? pathFor(object.geometry), missed)
      imagery?.outline(object?.geometry, missed)
      texture.needsUpdate = true
      render()
    },
    mark(marker, missed) {
      pin = null
      if (marker) {
        ray.set(terrain.position, surfacePoint(marker.longitude, marker.latitude))
        pin = geometry.boundsTree.raycastFirst(ray.ray, DoubleSide)?.point
        pinElement.classList.toggle('missed', missed)
      }
      render()
    },
    focus(id) {
      const object = catalog.get(id)
      if (!object) return
      const { longitude, latitude, span } = focusPoint(object.geometry)
      lookAt(longitude, latitude, Math.min(3.6, Math.max(1.085, 1.07 + span * radians * 2)))
    },
    rotate(horizontal, vertical) {
      const scale = controls.rotateSpeed / overviewRotationSpeed
      if (horizontal) controls.rotateLeft(horizontal * scale)
      if (vertical) controls.rotateUp(vertical * scale)
    },
    zoomIn: () => controls.dollyIn(0.75),
    zoomOut: () => controls.dollyOut(0.75),
    reset,
    dispose() {
      resizeObserver.disconnect()
      controls.dispose()
      imagery?.dispose()
      geometry.dispose()
      material.dispose()
      texture.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    },
  }
}
