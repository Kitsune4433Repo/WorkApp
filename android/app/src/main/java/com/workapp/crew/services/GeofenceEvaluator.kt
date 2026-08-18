package com.workapp.crew.services

import com.workapp.crew.data.local.entities.JobEntity
import kotlin.math.*

/**
 * On-device geofence check mirroring the backend's PostGIS `fn_point_in_job_geofence`, so the UI
 * can show instant "inside/outside geofence" feedback while offline; the server call on
 * clock-in/out remains authoritative once connectivity returns.
 */
object GeofenceEvaluator {

    fun isWithinGeofence(job: JobEntity, lat: Double, lng: Double): Boolean {
        job.geofencePolygonJson?.let { json ->
            val points = parsePolygon(json)
            if (points.size >= 3) return isPointInPolygon(lat, lng, points)
        }
        val radius = job.geofenceRadiusM ?: return true // no geofence configured: don't block
        return haversineMeters(lat, lng, job.siteLat, job.siteLng) <= radius
    }

    private fun haversineMeters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val earthRadiusM = 6_371_000.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a = sin(dLat / 2).pow(2) + cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLng / 2).pow(2)
        return earthRadiusM * 2 * atan2(sqrt(a), sqrt(1 - a))
    }

    // Standard ray-casting point-in-polygon test.
    private fun isPointInPolygon(lat: Double, lng: Double, polygon: List<Pair<Double, Double>>): Boolean {
        var inside = false
        var j = polygon.size - 1
        for (i in polygon.indices) {
            val (latI, lngI) = polygon[i]
            val (latJ, lngJ) = polygon[j]
            if ((lngI > lng) != (lngJ > lng) &&
                lat < (latJ - latI) * (lng - lngI) / (lngJ - lngI) + latI
            ) {
                inside = !inside
            }
            j = i
        }
        return inside
    }

    private fun parsePolygon(json: String): List<Pair<Double, Double>> {
        // Expected shape: [{"lat":..,"lng":..}, ...] — parsed with the app's shared Moshi instance
        // in the real implementation; simplified here to keep this file dependency-free.
        return Regex("\"lat\":(-?[0-9.]+),\"lng\":(-?[0-9.]+)").findAll(json).map {
            it.groupValues[1].toDouble() to it.groupValues[2].toDouble()
        }.toList()
    }
}
