/** Ortsvorgaben fuer den Schattenrechner. */

export interface CityPreset {
  name: string
  country: string
  latitude: number
  longitude: number
  /** Stunden gegenueber UTC (Normalzeit) */
  timezone: number
}

export const CITY_PRESETS: CityPreset[] = [
  { name: 'Berlin', country: 'Deutschland', latitude: 52.52, longitude: 13.405, timezone: 1 },
  { name: 'Hamburg', country: 'Deutschland', latitude: 53.551, longitude: 9.994, timezone: 1 },
  { name: 'München', country: 'Deutschland', latitude: 48.137, longitude: 11.575, timezone: 1 },
  { name: 'Köln', country: 'Deutschland', latitude: 50.938, longitude: 6.96, timezone: 1 },
  { name: 'Frankfurt am Main', country: 'Deutschland', latitude: 50.11, longitude: 8.682, timezone: 1 },
  { name: 'Stuttgart', country: 'Deutschland', latitude: 48.776, longitude: 9.183, timezone: 1 },
  { name: 'Leipzig', country: 'Deutschland', latitude: 51.34, longitude: 12.375, timezone: 1 },
  { name: 'Wien', country: 'Österreich', latitude: 48.208, longitude: 16.373, timezone: 1 },
  { name: 'Graz', country: 'Österreich', latitude: 47.071, longitude: 15.439, timezone: 1 },
  { name: 'Salzburg', country: 'Österreich', latitude: 47.809, longitude: 13.055, timezone: 1 },
  { name: 'Zürich', country: 'Schweiz', latitude: 47.377, longitude: 8.542, timezone: 1 },
  { name: 'Bern', country: 'Schweiz', latitude: 46.948, longitude: 7.447, timezone: 1 },
  { name: 'Genf', country: 'Schweiz', latitude: 46.204, longitude: 6.143, timezone: 1 },
  { name: 'Paris', country: 'Frankreich', latitude: 48.857, longitude: 2.352, timezone: 1 },
  { name: 'Amsterdam', country: 'Niederlande', latitude: 52.37, longitude: 4.895, timezone: 1 },
  { name: 'Kopenhagen', country: 'Dänemark', latitude: 55.676, longitude: 12.568, timezone: 1 },
  { name: 'Stockholm', country: 'Schweden', latitude: 59.329, longitude: 18.069, timezone: 1 },
  { name: 'Oslo', country: 'Norwegen', latitude: 59.914, longitude: 10.752, timezone: 1 },
  { name: 'London', country: 'Vereinigtes Königreich', latitude: 51.507, longitude: -0.128, timezone: 0 },
  { name: 'Madrid', country: 'Spanien', latitude: 40.417, longitude: -3.704, timezone: 1 },
  { name: 'Rom', country: 'Italien', latitude: 41.903, longitude: 12.496, timezone: 1 },
  { name: 'Warschau', country: 'Polen', latitude: 52.23, longitude: 21.012, timezone: 1 },
  { name: 'Prag', country: 'Tschechien', latitude: 50.076, longitude: 14.438, timezone: 1 },
  { name: 'New York', country: 'USA', latitude: 40.713, longitude: -74.006, timezone: -5 },
  { name: 'San Francisco', country: 'USA', latitude: 37.775, longitude: -122.419, timezone: -8 },
  { name: 'Tokio', country: 'Japan', latitude: 35.689, longitude: 139.692, timezone: 9 },
  { name: 'Sydney', country: 'Australien', latitude: -33.869, longitude: 151.209, timezone: 10 },
]

export function findCity(name: string): CityPreset | undefined {
  return CITY_PRESETS.find((city) => city.name === name)
}
