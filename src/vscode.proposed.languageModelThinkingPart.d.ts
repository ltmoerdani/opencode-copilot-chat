/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *---------------------------------------------------------------------------------------------

 * Type augmentation for the proposed `languageModelThinkingPart` API.
 *
 * CONTRACT:
 *   - `LanguageModelThinkingPart` is a proposed VS Code API (as of VS Code 1.102+,
 *     shipped August 2025 via PR microsoft/vscode#259939). It is NOT in stable
 *     `vscode.d.ts` yet, but IS available at runtime in all VS Code versions our
 *     extension targets (`engines.vscode: ^1.125.0`).
 *   - This file provides the compile-time declaration so `src/*.ts` can reference
 *     the class. At runtime, ALWAYS guard with
 *     `typeof vscode.LanguageModelThinkingPart === 'function'` before
 *     instantiating, to gracefully degrade on hypothetical older hosts.
 *   - No `enabledApiProposals` entry in package.json is required: the proposal
 *     is activated implicitly via our existing `onLanguageModelChatProvider:*`
 *     activation events (same pattern as `chatProvider`).
 *   - Source: copied from VS Code repo
 *     `src/vscode-dts/vscode.proposed.languageModelThinkingPart.d.ts` (main, Jul 2026).
 *   - Can be removed once the API graduates to stable `vscode.d.ts`.
 */

// version: 1

declare module "vscode" {
  /**
   * A language model response part containing thinking/reasoning content.
   * Thinking tokens represent the model's internal reasoning process that
   * typically streams before the final response.
   */
  export class LanguageModelThinkingPart {
    /**
     * The thinking/reasoning text content.
     */
    value: string | string[];

    /**
     * Optional unique identifier for this thinking sequence.
     * This ID is typically provided at the end of the thinking stream
     * and can be used for retrieval or reference purposes.
     */
    id?: string;

    /**
     * Optional metadata associated with this thinking sequence.
     */
    metadata?: { readonly [key: string]: unknown };

    /**
     * Construct a thinking part with the given content.
     * @param value The thinking text content.
     * @param id Optional unique identifier for this thinking sequence.
     * @param metadata Optional metadata associated with this thinking sequence.
     */
    constructor(value: string | string[], id?: string, metadata?: { readonly [key: string]: unknown });
  }
}
