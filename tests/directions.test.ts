import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { parseInput } from '../src/engine/parse'

describe('Direction Set Parsing', () => {
    it('parses direction sets without explicit backsight (implied)', () => {
        const filePath = path.join(process.cwd(), 'tests/fixtures/repro_directions.dat')
        const input = fs.readFileSync(filePath, 'utf-8')

        const result = parseInput(input)

        // Should parse stations
        expect(Object.keys(result.stations)).toContain('S1')
        expect(Object.keys(result.stations)).toContain('T1')
        expect(Object.keys(result.stations)).toContain('T2')

        // Should produce direction observations (raw circle readings with orientation parameter)
        const directions = result.observations.filter(o => o.type === 'direction')
        expect(directions.length).toBeGreaterThan(0)

        const t1 = directions.find(o =>
            (o as any).at === 'S1' &&
            (o as any).to === 'T1'
        )
        const t2 = directions.find(o =>
            (o as any).at === 'S1' &&
            (o as any).to === 'T2'
        )
        expect(t1).toBeDefined()
        expect(t2).toBeDefined()

        // Log errors if parsing fails expectations
        if (directions.length === 0) {
            console.log('Parser Logs:', result.logs)
        }
    })
})
