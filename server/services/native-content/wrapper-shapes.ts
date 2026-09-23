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
 * ## A shape holds STRUCTURE; a record holds NAMES
 *
 * `functionSignature`, `starterCode` and `wrapperTemplate` carry placeholders —
 * `__FN__` for the function name, `__P1__`/`__P2__` for parameters — expanded
 * from the record's `functionContract` when the shape is expanded. The wrapper
 * is included because it has to call the function by name.
 *
 * Without this the signature was a property of the shape, so every record using
 * one declared the same `solve(values)`. A record could still carry a
 * descriptive `functionContract`, which `ProblemPanel` renders — and then the
 * statement panel and the editor would say different things about the same
 * function. A contract mismatch is worse than a generic name: the reader cannot
 * tell which one the grader believes. See D33.
 *
 * Names were never what this file deduplicated. The 117,900 bytes were the
 * seven template fields, not three identifiers.
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
      functionSignature: 'long long __FN__(const long long *__P1__, int n)',
      starterCode:
        'long long __FN__(const long long *__P1__, int n) {\n  // Write your solution here.\n  return 0;\n}',
      wrapperTemplate:
        '#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n/*__USER_CODE__*/\nint main(void){int n=0,cap=16; long long *a=malloc(sizeof(long long)*cap),x; while(scanf("%lld",&x)==1){if(n==cap){cap*=2;a=realloc(a,sizeof(long long)*cap);}a[n++]=x;} printf("%lld",__FN__(a,n)); free(a); return 0;}',
      serialization: {
        input: 'Whitespace-separated signed integers read into the array parameter.',
        output: 'One signed integer.',
        equality: 'exact_json',
      },
    },
    cpp17: {
      displayName: 'C++',
      runtimeVersion: null,
      judge0LanguageId: null,
      functionSignature: 'long long __FN__(const vector<long long>& __P1__)',
      starterCode:
        'long long __FN__(const vector<long long>& __P1__) {\n  // Write your solution here.\n  return 0;\n}',
      wrapperTemplate:
        '#include <bits/stdc++.h>\nusing namespace std;\n/*__USER_CODE__*/\nint main(){ios::sync_with_stdio(false);cin.tie(nullptr);vector<long long>a;long long x;while(cin>>x)a.push_back(x);cout<<__FN__(a);}',
      serialization: {
        input: 'Whitespace-separated signed integers read into the array parameter.',
        output: 'One signed integer.',
        equality: 'exact_json',
      },
    },
    java: {
      displayName: 'Java',
      runtimeVersion: null,
      judge0LanguageId: null,
      functionSignature: 'static long __FN__(long[] __P1__)',
      starterCode:
        'static long __FN__(long[] __P1__) {\n  // Write your solution here.\n  return 0L;\n}',
      wrapperTemplate:
        'import java.io.*;\nimport java.util.*;\npublic class Main {\n/*__USER_CODE__*/\npublic static void main(String[] args)throws Exception{String s=new String(System.in.readAllBytes()).trim();if(s.isEmpty()){System.out.print(__FN__(new long[0]));return;}String[]p=s.split("\\\\s+");long[]a=new long[p.length];for(int i=0;i<p.length;i++)a[i]=Long.parseLong(p[i]);System.out.print(__FN__(a));}\n}',
      serialization: {
        input: 'Whitespace-separated signed integers read into the array parameter.',
        output: 'One signed integer.',
        equality: 'exact_json',
      },
    },
    python3: {
      displayName: 'Python',
      runtimeVersion: null,
      judge0LanguageId: null,
      functionSignature: 'def __FN__(__P1__: list[int]) -> int',
      starterCode:
        'def __FN__(__P1__: list[int]) -> int:\n    # Write your solution here.\n    return 0',
      wrapperTemplate:
        '/*__USER_CODE__*/\nif __name__ == "__main__":\n    import sys\n    __P1__ = [int(x) for x in sys.stdin.read().split()]\n    print(__FN__(__P1__))',
      serialization: {
        input: 'Whitespace-separated signed integers read into the array parameter.',
        output: 'One signed integer.',
        equality: 'exact_json',
      },
    },
    javascript: {
      displayName: 'JavaScript',
      runtimeVersion: null,
      judge0LanguageId: null,
      functionSignature: 'function __FN__(__P1__)',
      starterCode: 'function __FN__(__P1__) {\n  // Write your solution here.\n  return 0;\n}',
      wrapperTemplate:
        'const fs = require("fs");\n/*__USER_CODE__*/\nconst raw=fs.readFileSync(0,"utf8").trim();const __P1__=raw?raw.split(/\\s+/).map(Number):[];console.log(String(__FN__(__P1__)));',
      serialization: {
        input: 'Whitespace-separated signed integers read into the array parameter.',
        output: 'One signed integer.',
        equality: 'exact_json',
      },
    },
  },
  /**
   * `int-array-int-to-int`: one leading signed integer, then the array.
   *
   * The wire format is deliberately IDENTICAL to what six records already
   * emit — `7 1 6 2 5 3 4` is a target of 7 and a collection of six prices —
   * so migrating a problem onto this shape changes **no test-case data** and
   * cannot disturb a graded case. Only the solver's view improves: the scalar
   * arrives as its own named argument instead of being dug out of `values[0]`.
   *
   * That is what those records were doing. Two of them said so in prose:
   * "values[0] is the target". The prose was describing the wrapper, not the
   * problem.
   *
   * Empty input yields an empty array and a scalar of 0, matching
   * `int-array-to-int`'s tolerance — a problem whose constraints allow no
   * elements should not crash the wrapper before the solver is reached.
   */
  'int-array-int-to-int': {
    c11: {
      displayName: 'C',
      runtimeVersion: null,
      judge0LanguageId: null,
      functionSignature: 'long long __FN__(const long long *__P1__, int n, long long __P2__)',
      starterCode:
        'long long __FN__(const long long *__P1__, int n, long long __P2__) {\n  // Write your solution here.\n  return 0;\n}',
      wrapperTemplate:
        '#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n/*__USER_CODE__*/\nint main(void){int n=0,cap=16,first=1; long long *a=malloc(sizeof(long long)*cap),x,k=0; while(scanf("%lld",&x)==1){if(first){k=x;first=0;continue;}if(n==cap){cap*=2;a=realloc(a,sizeof(long long)*cap);}a[n++]=x;} printf("%lld",__FN__(a,n,k)); free(a); return 0;}',
      serialization: {
        input: 'The first signed integer is the scalar parameter; the rest form the array.',
        output: 'One signed integer.',
        equality: 'exact_json',
      },
    },
    cpp17: {
      displayName: 'C++',
      runtimeVersion: null,
      judge0LanguageId: null,
      functionSignature: 'long long __FN__(const vector<long long>& __P1__, long long __P2__)',
      starterCode:
        'long long __FN__(const vector<long long>& __P1__, long long __P2__) {\n  // Write your solution here.\n  return 0;\n}',
      wrapperTemplate:
        '#include <bits/stdc++.h>\nusing namespace std;\n/*__USER_CODE__*/\nint main(){ios::sync_with_stdio(false);cin.tie(nullptr);vector<long long>a;long long x,k=0;bool first=true;while(cin>>x){if(first){k=x;first=false;continue;}a.push_back(x);}cout<<__FN__(a,k);}',
      serialization: {
        input: 'The first signed integer is the scalar parameter; the rest form the array.',
        output: 'One signed integer.',
        equality: 'exact_json',
      },
    },
    java: {
      displayName: 'Java',
      runtimeVersion: null,
      judge0LanguageId: null,
      functionSignature: 'static long __FN__(long[] __P1__, long __P2__)',
      starterCode:
        'static long __FN__(long[] __P1__, long __P2__) {\n  // Write your solution here.\n  return 0L;\n}',
      wrapperTemplate:
        'import java.io.*;\nimport java.util.*;\npublic class Main {\n/*__USER_CODE__*/\npublic static void main(String[] args)throws Exception{String s=new String(System.in.readAllBytes()).trim();if(s.isEmpty()){System.out.print(__FN__(new long[0],0L));return;}String[]p=s.split("\\\\s+");long k=Long.parseLong(p[0]);long[]a=new long[p.length-1];for(int i=1;i<p.length;i++)a[i-1]=Long.parseLong(p[i]);System.out.print(__FN__(a,k));}\n}',
      serialization: {
        input: 'The first signed integer is the scalar parameter; the rest form the array.',
        output: 'One signed integer.',
        equality: 'exact_json',
      },
    },
    python3: {
      displayName: 'Python',
      runtimeVersion: null,
      judge0LanguageId: null,
      functionSignature: 'def __FN__(__P1__: list[int], __P2__: int) -> int',
      starterCode:
        'def __FN__(__P1__: list[int], __P2__: int) -> int:\n    # Write your solution here.\n    return 0',
      wrapperTemplate:
        '/*__USER_CODE__*/\nif __name__ == "__main__":\n    import sys\n    _read = [int(x) for x in sys.stdin.read().split()]\n    print(__FN__(_read[1:], _read[0] if _read else 0))',
      serialization: {
        input: 'The first signed integer is the scalar parameter; the rest form the array.',
        output: 'One signed integer.',
        equality: 'exact_json',
      },
    },
    javascript: {
      displayName: 'JavaScript',
      runtimeVersion: null,
      judge0LanguageId: null,
      functionSignature: 'function __FN__(__P1__, __P2__)',
      starterCode:
        'function __FN__(__P1__, __P2__) {\n  // Write your solution here.\n  return 0;\n}',
      wrapperTemplate:
        'const fs = require("fs");\n/*__USER_CODE__*/\nconst raw=fs.readFileSync(0,"utf8").trim();const read=raw?raw.split(/\\s+/).map(Number):[];console.log(String(__FN__(read.slice(1), read.length?read[0]:0)));',
      serialization: {
        input: 'The first signed integer is the scalar parameter; the rest form the array.',
        output: 'One signed integer.',
        equality: 'exact_json',
      },
    },
  },
} as const satisfies Record<string, Record<ExecutionLanguage, ShapeTemplate>>;

/** The placeholders a shape template may carry, in parameter order. */
export const SHAPE_PARAM_PLACEHOLDERS = ['__P1__', '__P2__'] as const;
export const SHAPE_FUNCTION_PLACEHOLDER = '__FN__';

/**
 * Substitute a record's names into a shape's templates.
 *
 * Every occurrence is replaced, in `functionSignature`, `starterCode` AND
 * `wrapperTemplate` — the wrapper because it calls the function by name, so a
 * wrapper left holding `__FN__` would not compile.
 *
 * Throws rather than leaving a placeholder behind. A template that still says
 * `__P2__` after expansion means the shape expects more parameters than the
 * record named, and the failure a silent pass produces is a compile error in
 * five languages at validation time — far from the record that caused it.
 */
export function applyShapeNames(
  template: ShapeTemplate,
  names: { functionName: string; parameterNames: readonly string[] },
): ShapeTemplate {
  const substitute = (text: string): string => {
    let out = text.split(SHAPE_FUNCTION_PLACEHOLDER).join(names.functionName);
    SHAPE_PARAM_PLACEHOLDERS.forEach((placeholder, index) => {
      const name = names.parameterNames[index];
      if (name === undefined) return;
      out = out.split(placeholder).join(name);
    });
    return out;
  };

  const expanded: ShapeTemplate = {
    ...template,
    functionSignature: substitute(template.functionSignature),
    starterCode: substitute(template.starterCode),
    wrapperTemplate: substitute(template.wrapperTemplate),
  };

  for (const [field, text] of [
    ['functionSignature', expanded.functionSignature],
    ['starterCode', expanded.starterCode],
    ['wrapperTemplate', expanded.wrapperTemplate],
  ] as const) {
    const leftover = [SHAPE_FUNCTION_PLACEHOLDER, ...SHAPE_PARAM_PLACEHOLDERS].find((token) =>
      text.includes(token),
    );
    if (leftover) {
      throw new Error(
        `${field} still contains ${leftover} after expansion. The record named ` +
          `${names.parameterNames.length} parameter(s); this shape needs more.`,
      );
    }
  }

  return expanded;
}

export type WrapperShapeId = keyof typeof WRAPPER_SHAPES;

export const WRAPPER_SHAPE_IDS = Object.keys(WRAPPER_SHAPES) as [
  WrapperShapeId,
  ...WrapperShapeId[],
];

/**
 * How many parameters a shape's function takes, read from the placeholders its
 * signatures actually carry rather than declared alongside them, so the count
 * cannot drift from the templates. Throws if two languages disagree, because a
 * shape whose C signature takes two names and whose Python one takes one is
 * broken whichever count a record picks.
 */
export function shapeArity(shape: WrapperShapeId): number {
  const counts = new Set(
    Object.values(WRAPPER_SHAPES[shape]).map(
      (template: ShapeTemplate) =>
        SHAPE_PARAM_PLACEHOLDERS.filter((placeholder) =>
          template.functionSignature.includes(placeholder),
        ).length,
    ),
  );
  if (counts.size !== 1) {
    throw new Error(`Shape ${shape} takes a different number of parameters per language.`);
  }
  return [...counts][0]!;
}
