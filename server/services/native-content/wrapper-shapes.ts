/**
 * Wrapper shapes: the per-language execution contract, held once.
 *
 * ## Why this file exists
 *
 * Every native problem record used to carry its own copy of seven identical
 * fields per language — the wrapper template, the function signature, the
 * starter code, the serialization contract and three display fields. Measured
 * across the hundred-record library, all seven were byte-identical in all five
 * languages: 117,900 bytes of duplication, and no single place to change a
 * wrapper. At a few thousand problems that is several megabytes of repeated
 * string, and editing one wrapper would mean rewriting every record.
 *
 * A record now names a shape and supplies only its `referenceSolution`, which
 * is the one field that genuinely varies per problem.
 *
 * ## What a shape is
 *
 * A shape is the input/output contract a problem speaks: what the wrapper reads
 * from stdin, what it prints, and what signature the solver implements. It is a
 * property of the problem, not of a language, so it is named once per record
 * and expanded across all five.
 *
 * ## Where expansion happens
 *
 * `nativeProblemBatchSchema` expands a shape while parsing, so every consumer
 * downstream — `validateNativeLibrary`, the importer, the reference validator
 * — receives exactly the object it received before this file existed. Nothing
 * reaches the database as a shape: the importer writes the expanded template
 * text into `problem_language_templates` as it always did, and the live
 * execution path reads those rows and never sees this file.
 *
 * ## Adding a shape
 *
 * Adding one means authoring all seven fields in all five languages and proving
 * them against a real problem in each. See `docs/authoring-problems.md` §2 for
 * what is and is not supported today, and what a new shape costs.
 *
 * Generated from the library by `.tmp/gen-registry.ts` so the initial values
 * are exactly what the records already held.
 */
import type { ExecutionLanguage } from '@/lib/execution/languages';

type ShapeTemplate = {
  displayName: string;
  runtimeVersion: string | null;
  judge0LanguageId: number | null;
  functionSignature: string;
  starterCode: string;
  wrapperTemplate: string;
  serialization: { input: string; output: string; equality: 'exact_json' };
};

/**
 * `int-array-to-int`: one line of whitespace-separated signed integers into a
 * single array, one signed integer printed back. The only shape the wrappers
 * implement today.
 */
export const WRAPPER_SHAPES = {
  'int-array-to-int': {
    c11: {
      displayName: 'C',
      runtimeVersion: null,
      judge0LanguageId: null,
      functionSignature: 'long long solve(const long long *values, int n)',
      starterCode:
        'long long solve(const long long *values, int n) {\n  // Write your solution here.\n  return 0;\n}',
      wrapperTemplate:
        '#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n/*__USER_CODE__*/\nint main(void){int n=0,cap=16; long long *a=malloc(sizeof(long long)*cap),x; while(scanf("%lld",&x)==1){if(n==cap){cap*=2;a=realloc(a,sizeof(long long)*cap);}a[n++]=x;} printf("%lld",solve(a,n)); free(a); return 0;}',
      serialization: {
        input: 'Whitespace-separated signed integers read into values.',
        output: 'One signed integer.',
        equality: 'exact_json',
      },
    },
    cpp17: {
      displayName: 'C++',
      runtimeVersion: null,
      judge0LanguageId: null,
      functionSignature: 'long long solve(const vector<long long>& values)',
      starterCode:
        'long long solve(const vector<long long>& values) {\n  // Write your solution here.\n  return 0;\n}',
      wrapperTemplate:
        '#include <bits/stdc++.h>\nusing namespace std;\n/*__USER_CODE__*/\nint main(){ios::sync_with_stdio(false);cin.tie(nullptr);vector<long long>a;long long x;while(cin>>x)a.push_back(x);cout<<solve(a);}',
      serialization: {
        input: 'Whitespace-separated signed integers read into values.',
        output: 'One signed integer.',
        equality: 'exact_json',
      },
    },
    java: {
      displayName: 'Java',
      runtimeVersion: null,
      judge0LanguageId: null,
      functionSignature: 'static long solve(long[] values)',
      starterCode:
        'static long solve(long[] values) {\n  // Write your solution here.\n  return 0L;\n}',
      wrapperTemplate:
        'import java.io.*;\nimport java.util.*;\npublic class Main {\n/*__USER_CODE__*/\npublic static void main(String[] args)throws Exception{String s=new String(System.in.readAllBytes()).trim();if(s.isEmpty()){System.out.print(solve(new long[0]));return;}String[]p=s.split("\\\\s+");long[]a=new long[p.length];for(int i=0;i<p.length;i++)a[i]=Long.parseLong(p[i]);System.out.print(solve(a));}\n}',
      serialization: {
        input: 'Whitespace-separated signed integers read into values.',
        output: 'One signed integer.',
        equality: 'exact_json',
      },
    },
    python3: {
      displayName: 'Python',
      runtimeVersion: null,
      judge0LanguageId: null,
      functionSignature: 'def solve(values: list[int]) -> int',
      starterCode:
        'def solve(values: list[int]) -> int:\n    # Write your solution here.\n    return 0',
      wrapperTemplate:
        '/*__USER_CODE__*/\nif __name__ == "__main__":\n    import sys\n    values = [int(x) for x in sys.stdin.read().split()]\n    print(solve(values))',
      serialization: {
        input: 'Whitespace-separated signed integers read into values.',
        output: 'One signed integer.',
        equality: 'exact_json',
      },
    },
    javascript: {
      displayName: 'JavaScript',
      runtimeVersion: null,
      judge0LanguageId: null,
      functionSignature: 'function solve(values)',
      starterCode: 'function solve(values) {\n  // Write your solution here.\n  return 0;\n}',
      wrapperTemplate:
        'const fs = require("fs");\n/*__USER_CODE__*/\nconst raw=fs.readFileSync(0,"utf8").trim();const values=raw?raw.split(/\\s+/).map(Number):[];console.log(String(solve(values)));',
      serialization: {
        input: 'Whitespace-separated signed integers read into values.',
        output: 'One signed integer.',
        equality: 'exact_json',
      },
    },
  },
} as const satisfies Record<string, Record<ExecutionLanguage, ShapeTemplate>>;

export type WrapperShapeId = keyof typeof WRAPPER_SHAPES;

export const WRAPPER_SHAPE_IDS = Object.keys(WRAPPER_SHAPES) as [
  WrapperShapeId,
  ...WrapperShapeId[],
];
