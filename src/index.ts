import type { Program } from 'estree'
import type { Plugin } from 'rollup'
import type { FilterPattern } from 'unplugin-utils'
import { walk } from 'estree-walker'
import MagicString from 'magic-string'
import { createFilter } from 'unplugin-utils'

export interface PureAnnotationsOptions {
  sourcemap?: boolean
  functions: string[]
  include?: FilterPattern
  exclude?: FilterPattern
}

interface Annotation {
  start: number
  annotation: string
}

const withLocations = <T>(node: T) => node as T & { start: number, end: number }
export function PluginPure(options: PureAnnotationsOptions): Plugin {
  const functionSet = new Set(options.functions)
  const filter = createFilter(options.include, options.exclude)

  return {
    name: 'rollup-plugin-pure',
    transform: {
      order: 'post',
      handler(code, id) {
        if (!filter(id)) {
          return
        }

        // quick check if any of the functions are in the code
        if (!options.functions.some(func => code.includes(func))) {
          return
        }

        let ast: Program
        try {
          ast = this.parse(code)
        }
        catch {
          return null
        }

        const s = new MagicString(code)
        const annotations: string[] = []

        walk(ast, {
          enter(_node) {
            const node = withLocations(_node)

            // Handle function declarations - add @__NO_SIDE_EFFECTS__ annotation
            if (
              node.type === 'FunctionDeclaration'
              && node.id
              && functionSet.has(node.id.name)
            ) {
              const annotation = '/*@__NO_SIDE_EFFECTS__*/ '
              s.prependRight(node.start, annotation)
              annotations.push(annotation)
            }

            // Handle function calls - add @__PURE__ annotation
            if (
              node.type === 'CallExpression'
              && node.callee.type === 'Identifier'
              && functionSet.has(node.callee.name)
            ) {
              const annotation = '/*@__PURE__*/ '
              s.prependRight(node.start, annotation)
              annotations.push(annotation)
            }

            if (annotations.length) {
              node.start += sumOffset(annotations)
            }
          },
          leave(_node) {
            const node = withLocations(_node)
            if (annotations.length) {
              node.end += sumOffset(annotations)
            }
          },
        })

        if (annotations.length) {
          return {
            code: s.toString(),
            ast: withLocations(ast),
            map: options.sourcemap ? /* v8-ignore */ s.generateMap({ hires: true }) : undefined,
          }
        }
      },
    },
  }
}

function sumOffset(annotations: string[]) {
  return annotations.reduce((acc, annotation) => acc + annotation.length, 0)
}
