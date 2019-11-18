
const fs = require('fs')
const { createCanvas } = require('canvas')
const shapefile = require('shapefile')
const signale = require('signale')
const proj = require('mercator-projection')
const {locations} = require('../data/location-history.json')

const toMercator = proj.fromLatLngToPoint

const constants = {
  paths: {
    graph: 'graph.png',
    roads: 'data/shapefiles/gis_osm_roads_free_1.shp',
    location: 'data/location-history.json'
  },
  resolution: {
    x: 4000
  },
  colours: {
    background: '#141518',
    road: '#D3D3D3',
    location: '#ce8c16'
  }
}

/**
 *
 * @param {string} fpath the shapefile path
 * @param {function} onResult a function to call on each generator result
 */
const readShapeFile = async (fpath, onResult) => {
  const source = await shapefile.open(fpath)

  let result = null

  while (!result || !result.done) {
    result = await source.read()
    onResult(result.value)
  }
}

const draw = {}

/**
 *
 * @param {object} min
 * @param {object} max
 */
draw.canvas = (min, max) => {
  const diff = {
    x: max.lon - min.lon,
    y: max.lat - min.lat
  }

  const yResolution = constants.resolution.x * (diff.y / diff.x)

  const canvas = createCanvas(constants.resolution.x, yResolution)
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = constants.colours.background
  ctx.fillRect(0, 0, constants.resolution.x, yResolution)

  return {
    canvas,
    ctx,
    resolution: {
      x: constants.resolution.x,
      y: yResolution
    }
  }
}

/**
 *
 * @param {number} num
 * @param {object} extrema
 */
const transform = (num, { min, max }) => {
  return (num - min) / (max - min)
}

/**
 *
 */
draw.roads = ({canvas, ctx, state, resolution, opts}) => datum => {
  if (!datum) {
    return
  }
  let previous = null

  for (const [lon, lat] of datum.geometry.coordinates) {
    const point = toMercator({ lng: lon, lat })

    const x = transform(point.x, {
      min: state.min.lon,
      max: state.max.lon
    }) * resolution.x
    const y = transform(point.y, {
      min: state.min.lat,
      max: state.max.lat
    }) * resolution.y

    ctx.globalAlpha = 0.8

    if (previous) {
      ctx.strokeStyle = opts.colour
      ctx.beginPath()
      ctx.moveTo(previous.x, previous.y)
      ctx.lineTo(x, y)
      ctx.stroke()
    }

    previous = {x, y}
  }
}

const distance = (p1, p2) => {
  const dx = Math.pow(p1.x - p2.x, 2)
  const dy = Math.pow(p1.y - p2.y, 2)

  return Math.sqrt(dx + dy)
}

draw.locationData = ({canvas, ctx, resolution, state, opts}) => {
  ctx.fillStyle = constants.colours.location

  for (const location of locations) {
    const lat = location.latitudeE7 / 1e7
    const lon = location.longitudeE7 / 1e7

    const point = toMercator({lat, lng: lon})

    const x = transform(point.x, {
      min: state.min.lon,
      max: state.max.lon
    }) * resolution.x
    const y = transform(point.y, {
      min: state.min.lat,
      max: state.max.lat
    }) * resolution.y

    ctx.globalAlpha = 0.4
    ctx.fillRect(x, y, 10, 10)
  }

  ctx.stroke()
}

const saveGraph = (fpath, canvas) => {
  const out = fs.createWriteStream(fpath)
  const stream = canvas.createPNGStream()
  stream.pipe(out)
  out.on('finish', () => {
    signale.success('saved graph')
  })
}

const calculateShapefileExtrema = async (fpath) => {
  const max = {
    lon: -Infinity,
    lat: -Infinity
  }
  const min = {
    lon: Infinity,
    lat: Infinity
  }

  await readShapeFile(fpath, datum => {
    if (!datum) {
      return
    }

    for (const [lon, lat] of datum.geometry.coordinates) {
      const point = toMercator({ lng: lon, lat })

      if (point.x > max.lon) {
        max.lon = point.x
      } else if (point.x < min.lon) {
        min.lon = point.x
      }

      if (point.y > max.lat) {
        max.lat = point.y
      } else if (point.y < min.lat) {
        min.lat = point.y
      }
    }
  })

  return {min, max}
}

const main = async () => {
  const state = {
    max: {
      lon: -Infinity,
      lat: -Infinity
    },
    min: {
      lon: Infinity,
      lat: Infinity
    }
  }

  signale.info('computing min / max latitudes for shapefile')

  const { min, max } = await calculateShapefileExtrema(constants.paths.roads)

  state.min = min
  state.max = max

  const { canvas, ctx, resolution } = draw.canvas(min, max)

  signale.info('drawing to shapefile')
  draw.locationData({
    canvas,
    ctx,
    resolution,
    state,
    opts: {
      colour: constants.colours.location
    }
  })

 await readShapeFile(constants.paths.roads, draw.roads({
   canvas,
   ctx,
   resolution,
   state,
   opts: {
     colour: constants.colours.road
   }
 }))

  signale.info('saving graph')

  saveGraph(constants.paths.graph, canvas)
}

main()
