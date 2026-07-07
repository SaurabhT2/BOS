/**
 * @brandos/artifact-engine-layer — skill-registry.ts
 *
 * PlatformPluginRegistry — IPlatformPluginRegistry implementation.
 *
 * WHAT IT DOES:
 *   A runtime registry for modular ISkill and WorkflowDefinition registrations.
 *   Skills are registered at startup and dispatched by string ID, not by import.
 *
 * PROBLEM THIS SOLVES:
 *   Before this registry, skills were directly imported by consuming modules.
 *   Direct imports create hard coupling: adding a new skill required modifying
 *   the import list in every consumer. This breaks modularity and makes ICP
 *   bundle composition impossible.
 *
 *   After this registry: skills are registered at runtime. ICP bundles register
 *   their own skills without any change to the core runtime. The engine's
 *   governance adapters dispatch skills by ID via this registry.
 *
 * SKILL EXECUTION CONTRACT:
 *   1. Skill is registered with metadata.permissions[] (required permissions).
 *   2. executeSkill() checks context.granted_permissions[] at dispatch time.
 *   3. If any required permission is not granted, execution throws immediately.
 *   4. This is an authorization check, not authentication — identity is resolved upstream.
 *
 * WORKFLOW REGISTRATION:
 *   WorkflowDefinitions are stored by ID but not yet executed by this registry.
 *   Workflow execution is planned for a future IPlatformWorkflowEngine implementation.
 *   For now, workflows are stored and listed for orchestration layer discovery.
 *
 * DUPLICATE REGISTRATION BEHAVIOR:
 *   - Skills: warn + replace (idempotent, allows hot-swap in development).
 *   - Workflows: silent replace (workflows may be updated during hot reload).
 *
 * THREAD SAFETY:
 *   Registration is expected at startup (synchronous, before requests).
 *   executeSkill() is read-only on the registry Map — safe for concurrent reads.
 *
 * SINGLETON:
 *   globalPluginRegistry is the server-level singleton.
 *   Use a fresh PlatformPluginRegistry instance per test for isolation.
 */

import type {
  ISkill,
  IPlatformPluginRegistry,
  SkillMetadata,
  WorkflowDefinition,
  SkillContext,
} from '@brandos/contracts'

// ─── PlatformPluginRegistry ───────────────────────────────────────────────────

export class PlatformPluginRegistry implements IPlatformPluginRegistry {
  /**
   * Registered skills. Key: skill metadata ID string.
   * Stored as ISkill<any, any> because skill input/output types vary per skill.
   * Type safety is enforced at registration and at executeSkill() call sites.
   */
  private readonly skills = new Map<string, ISkill<unknown, unknown>>()

  /**
   * Registered workflow definitions. Key: workflow definition ID string.
   * Stored for discovery by orchestration layers. Not yet executed here.
   */
  private readonly workflows = new Map<string, WorkflowDefinition>()

  // ── Skill registration + dispatch ──────────────────────────────────────────

  /**
   * Register a skill.
   *
   * BEHAVIOR:
   *   - If a skill with the same ID is already registered: warns and replaces.
   *   - Returns `this` for fluent chaining.
   *
   * WHEN TO CALL:
   *   At server startup, from each package that owns skills (not from engine.ts itself).
   *   The PlatformPluginRegistry is dependency-injected into governance adapters that need skills.
   *
   * @param skill - The ISkill implementation with metadata and execute() method.
   */
  registerSkill(skill: ISkill): this {
    if (this.skills.has(skill.metadata.id)) {
      console.warn(
        `[PluginRegistry] Skill "${skill.metadata.id}" is already registered — replacing. ` +
        `If this is not intentional (e.g., duplicate bootstrap call), check registration order.`
      )
    }
    this.skills.set(skill.metadata.id, skill as ISkill<unknown, unknown>)
    console.info(
      `[PluginRegistry] Skill registered: ${skill.metadata.id} v${skill.metadata.version}`
    )
    return this
  }

  /**
   * Register a workflow definition for orchestration discovery.
   *
   * BEHAVIOR:
   *   - Silent replace if workflow with same ID already exists.
   *   - Returns `this` for fluent chaining.
   *   - Workflow execution is NOT handled here (future WorkflowEngine responsibility).
   *
   * @param definition - The WorkflowDefinition to store.
   */
  registerWorkflow(definition: WorkflowDefinition): this {
    this.workflows.set(definition.id, definition)
    return this
  }

  /**
   * Retrieve a registered skill by ID without executing it.
   *
   * USE CASE: Checking if a skill is available before deciding to dispatch.
   * For execution, use executeSkill() which handles permissions.
   *
   * @param id - The skill metadata ID.
   * @returns ISkill instance, or undefined if not registered.
   */
  getSkill(id: string): ISkill | undefined {
    return this.skills.get(id) as ISkill | undefined
  }

  /**
   * List metadata for all registered skills.
   *
   * USE CASE: Admin introspection, capability discovery, debug logging.
   * Returns skill metadata only — does not expose execute() methods.
   *
   * @returns Array of SkillMetadata for all registered skills.
   */
  listSkills(): SkillMetadata[] {
    return [...this.skills.values()].map(s => s.metadata)
  }

  /**
   * List all registered workflow definitions.
   *
   * USE CASE: Orchestration layer discovery of available workflows.
   *
   * @returns Array of WorkflowDefinition for all registered workflows.
   */
  listWorkflows(): WorkflowDefinition[] {
    return [...this.workflows.values()]
  }

  /**
   * Execute a registered skill by ID with permission enforcement.
   *
   * PERMISSION CHECK FLOW:
   *   1. Resolve skill by ID — throw if not found.
   *   2. Get skill.metadata.permissions[] (required permissions).
   *   3. Get context.granted_permissions[] (caller-granted permissions).
   *   4. Compute missing = required − granted.
   *   5. If missing.length > 0: throw with the list of missing permissions.
   *   6. Call skill.execute(input, context) and return its result.
   *
   * EDGE CASES:
   *   - skill.metadata.permissions is undefined or empty: no permission check needed.
   *   - context.granted_permissions is undefined: treated as empty (no permissions granted).
   *   - skill.execute() throws: the error propagates to the caller (not caught here).
   *
   * @param skillId - The ID of the skill to execute.
   * @param input   - The typed input for the skill (TInput).
   * @param context - The execution context with granted_permissions.
   * @returns The skill's typed output (TOutput).
   * @throws Error if skill not found, or if required permissions are not granted.
   */
  async executeSkill<TInput = unknown, TOutput = unknown>(
    skillId: string,
    input: TInput,
    context: SkillContext
  ): Promise<TOutput> {
    const skill = this.skills.get(skillId)
    if (!skill) {
      throw new Error(
        `[PluginRegistry] Skill "${skillId}" not found. ` +
        `Registered skills: [${[...this.skills.keys()].join(', ')}]. ` +
        `Register the skill via registry.registerSkill() before dispatching.`
      )
    }

    // Permission enforcement: required permissions must all appear in granted list
    const requiredPermissions = skill.metadata.permissions ?? []
    const grantedPermissions  = context.granted_permissions ?? []
    const missingPermissions  = requiredPermissions.filter(p => !grantedPermissions.includes(p))

    if (missingPermissions.length > 0) {
      throw new Error(
        `[PluginRegistry] Skill "${skillId}" requires permissions: ` +
        `[${missingPermissions.join(', ')}] — not present in context.granted_permissions. ` +
        `Ensure the caller grants these permissions before executing this skill.`
      )
    }

    return skill.execute(input as never, context) as Promise<TOutput>
  }
}

// ─── Singleton global plugin registry ─────────────────────────────────────────
//
// Populated at runtime by each package that provides skills.
// Do NOT use in unit tests — create a fresh PlatformPluginRegistry per test.

export const globalPluginRegistry = new PlatformPluginRegistry()


