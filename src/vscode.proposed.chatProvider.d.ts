/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// version: 5

declare module "vscode" {
  /**
   * The provider version of {@linkcode LanguageModelChatRequestOptions}
   */
  export interface ProvideLanguageModelChatResponseOptions {
    /**
     * What extension initiated the request to the language model, or
     * `undefined` if the request was initiated by other functionality in the editor.
     */
    readonly requestInitiator: string;

    /**
     * Per-model configuration provided by the user. This contains values configured
     * in the user's language models configuration file, validated against the model's
     * {@linkcode LanguageModelChatInformation.configurationSchema configurationSchema}.
     */
    readonly modelConfiguration?: {
      readonly [key: string]: unknown;
    };
  }

  /**
   * All the information representing a single language model contributed by a {@linkcode LanguageModelChatProvider}.
   */
  export interface LanguageModelChatInformation {
    /**
     * When present, this gates the use of `requestLanguageModelAccess` behind an authorization flow where
     * the user must approve of another extension accessing the models contributed by this extension.
     * Additionally, the extension can provide a label that will be shown in the UI.
     * A common example of a label is an account name that is signed in.
     *
     */
    requiresAuthorization?: true | { label: string };

    /**
     * A numeric value for comparing model cost tiers.
     */
    readonly multiplierNumeric?: number;

    /**
     * Optional pricing label for this model, such as "Free", etc.
     * This value is meant for display purposes and will be shown in the model management UI.
     */
    readonly pricing?: string;

    /**
     * Optional input cost in AI credits for this model.
     * Displayed in the model management UI as the cost per million input tokens.
     */
    readonly inputCost?: number;

    /**
     * Optional output cost in AI credits for this model.
     * Displayed in the model management UI as the cost per million output tokens.
     */
    readonly outputCost?: number;

    /**
     * Optional cache cost in AI credits for this model.
     * Displayed in the model management UI as the cost per million cached tokens.
     */
    readonly cacheCost?: number;

    /**
     * Optional relative pricing category for this model (e.g. "low", "medium", "high", "very_high").
     * Displayed in the model picker as a visual indicator of relative cost.
     */
    readonly priceCategory?: string;

    /**
     * Whether or not this will be selected by default in the model picker
     * NOT BEING FINALIZED
     */
    readonly isDefault?: boolean | { [K in ChatLocation]?: boolean };

    /**
     * Whether or not the model will show up in the model picker immediately upon being made known via {@linkcode LanguageModelChatProvider.provideLanguageModelChatInformation}.
     * NOT BEING FINALIZED
     */
    readonly isUserSelectable?: boolean;

    readonly statusIcon?: ThemeIcon;

    /**
     * An optional JSON schema describing the configuration options for this model.
     * When set, users can specify per-model configuration in their language models
     * configuration file. The configured values are merged into the request options
     * when sending chat requests to this model.
     */
    readonly configurationSchema?: LanguageModelConfigurationSchema;

    /**
     * When set, this model is only shown in the model picker for the specified chat session type.
     * Models with this property are excluded from the general model picker and only appear
     * when the user is in a session matching this type.
     *
     * The value must match a `type` declared in a `chatSessions` extension contribution.
     */
    readonly targetChatSessionType?: string;
  }

  export interface LanguageModelChatCapabilities {
    /**
     * The tools the model prefers for making file edits.
     */
    readonly editTools?: string[];
  }

  export type LanguageModelResponsePart2 = LanguageModelResponsePart | LanguageModelDataPart | LanguageModelThinkingPart;

  /**
   * A [JSON Schema](https://json-schema.org) describing configuration options for a language model.
   */
  export type LanguageModelConfigurationSchema = {
    readonly type?: string;
    readonly properties?: {
      readonly [key: string]: Record<string, unknown> & {
        readonly enumItemLabels?: string[];
        readonly enumDescriptions?: string[];
        readonly group?: string;
      };
    };
  };

  export interface LanguageModelChatProvider<T extends LanguageModelChatInformation = LanguageModelChatInformation> {
    provideLanguageModelChatInformation(options: PrepareLanguageModelChatModelOptions, token: CancellationToken): ProviderResult<T[]>;
    provideLanguageModelChatResponse(
      model: T,
      messages: readonly LanguageModelChatRequestMessage[],
      options: ProvideLanguageModelChatResponseOptions,
      progress: Progress<LanguageModelResponsePart2>,
      token: CancellationToken,
    ): Thenable<void>;
  }

  export interface PrepareLanguageModelChatModelOptions {
    readonly configuration?: {
      readonly [key: string]: unknown;
    };
  }

  export interface ChatRequest {
    readonly modelConfiguration?: { readonly [key: string]: unknown };
  }
}
