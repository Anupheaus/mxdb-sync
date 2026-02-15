import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

const seededDataPath = path.join(process.cwd(), 'seededData.json');

export interface SeededData {
  [collectionName: string]: string;
}

export function loadSeededData(): SeededData {
  try {
    if (!existsSync(seededDataPath)) return {};
    return JSON.parse(readFileSync(seededDataPath, 'utf8'));
  } catch (error) {
    return {};
  }
}

export function saveSeededData(seededData: SeededData) {
  writeFileSync(seededDataPath, JSON.stringify(seededData, null, 2), 'utf8');
}