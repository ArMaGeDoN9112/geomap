from math import floor

from numpy import hypot
from pyproj import Proj
from shapely import Point, get_coordinates, segmentize, transform
from shapely.geometry import shape


def grade(geometry: dict, longitude: float, latitude: float) -> dict:
    area = shape(geometry)
    if area.covers(Point(longitude, latitude)):
        return {"correct": True, "distance_km": None, "distance_label": None}

    # Densify before projection so the measured shore follows the GeoJSON segments.
    projection = Proj(proj="aeqd", ellps="WGS84", lon_0=longitude, lat_0=latitude)
    boundary = transform(segmentize(area.boundary, 0.005), projection, interleaved=False)
    meters = boundary.distance(Point(0, 0))
    x, y = get_coordinates(boundary).T
    nearest_vertex = float(hypot(x, y).min())
    # A real edge is at most 560 m long after densification.
    if nearest_vertex - meters > 560:
        meters = nearest_vertex

    distance_km = floor(meters / 100 + 0.5) / 10
    label = "Менее 0,1 км" if meters < 100 else f"{distance_km:.1f} км".replace(".", ",")
    return {"correct": False, "distance_km": distance_km, "distance_label": label}
