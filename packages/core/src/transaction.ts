import { items } from './checks.js';
import { applyCommand, type CommandContext } from './commands.js';
import type { CanvasDocument } from './document.js';
import { Draft, type DraftOutcome, type ParentLookup } from './draft.js';
import { atCommand, fail, ok, validationError, type Result } from './result.js';

/**
 * Executa uma lista de comandos sobre um rascunho do documento, em ordem. Cada comando
 * enxerga o que os anteriores fizeram. Se algum for recusado, o rascunho é descartado e o
 * erro volta com a posição do comando: é tudo ou nada, e o documento recebido nunca muda.
 *
 * Devolve o documento resultante e o que mudou, ou `undefined` quando os comandos, juntos,
 * não mudaram nada.
 */
export function runCommands(
  document: CanvasDocument,
  parents: ParentLookup,
  commands: unknown,
  context: CommandContext,
): Result<DraftOutcome | undefined> {
  if (!Array.isArray(commands)) {
    return fail(
      validationError([{ path: [], rule: 'type', message: 'commands must be an array' }]),
    );
  }
  const draft = new Draft(document, parents);
  for (const [index, command] of items(commands)) {
    const error = applyCommand(draft, command, context);
    if (error) return fail(atCommand(error, index));
  }
  return ok(draft.finish());
}
