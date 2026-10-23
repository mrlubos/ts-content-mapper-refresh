import type { Dep } from './dep.js';
import type { Data } from './shape.data';

declare const dep: Dep;
declare const data: Data;

// Both lines are errors until `age` is added to `dep.ts` and to `shape.data`.
export const fromTs = dep.age;
export const fromData = data.age;
