/**
 * Stable, collision free id generation for every entity in the document.
 * Ids are short strings so that serialized documents stay compact and readable.
 */

export type Id = string

let counter = 0
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

function base36(n: number): string {
  if (n === 0) return '0'
  let out = ''
  while (n > 0) {
    out = ALPHABET[n % 36] + out
    n = Math.floor(n / 36)
  }
  return out
}

/** Session unique prefix so ids of merged documents never collide. */
const SESSION = base36(Math.floor(Math.random() * 46655) + 1).padStart(3, '0')

/**
 * Creates a new unique id. `prefix` is a single char describing the kind:
 * v=vertex e=edge f=face d=definition i=instance m=material t=tag s=scene
 * x=texture n=annotation p=sectionPlane g=guide c=style
 */
export function newId(prefix = 'x'): Id {
  counter += 1
  return `${prefix}${SESSION}${base36(counter)}`
}

/** Resets the counter, only used by tests and by document loading. */
export function resetIdCounter(value = 0): void {
  counter = value
}

/** Ensures the generator never produces an id that already exists in a loaded doc. */
export function bumpIdCounter(minimum: number): void {
  if (minimum > counter) counter = minimum
}

export function idKind(id: Id): string {
  return id.charAt(0)
}
