import { clonePlain, makeBranchId } from "./utils.js";

class BranchWorkspace {
  static makeDefaultBranching(baseState) {
    const now = new Date().toISOString();
    const branchId = makeBranchId();
    return {
      activeBranchId: branchId,
      selectedCheckpointId: null,
      branches: [{
        id: branchId,
        title: "Ветка 1",
        parentBranchId: null,
        parentCheckpointId: null,
        createdAt: now,
        updatedAt: now,
        state: clonePlain(baseState),
      }],
      checkpoints: [],
    };
  }

  static normalizeBranching(rawBranching, fallbackState) {
    const now = new Date().toISOString();
    const fallback = fallbackState && typeof fallbackState === "object" ? clonePlain(fallbackState) : {};
    if (!rawBranching || typeof rawBranching !== "object") return this.makeDefaultBranching(fallback);
    const branches = Array.isArray(rawBranching.branches)
      ? rawBranching.branches
          .filter((branch) => branch && typeof branch.id === "string")
          .map((branch, index) => ({
            id: branch.id,
            title: typeof branch.title === "string" && branch.title.trim() ? branch.title.trim() : `Ветка ${index + 1}`,
            parentBranchId: typeof branch.parentBranchId === "string" ? branch.parentBranchId : null,
            parentCheckpointId: typeof branch.parentCheckpointId === "string" ? branch.parentCheckpointId : null,
            createdAt: typeof branch.createdAt === "string" ? branch.createdAt : now,
            updatedAt: typeof branch.updatedAt === "string" ? branch.updatedAt : now,
            state: branch.state && typeof branch.state === "object" ? clonePlain(branch.state) : clonePlain(fallback),
          }))
      : [];
    if (branches.length === 0) return this.makeDefaultBranching(fallback);
    const checkpoints = Array.isArray(rawBranching.checkpoints)
      ? rawBranching.checkpoints
          .filter((cp) => cp && typeof cp.id === "string" && typeof cp.branchId === "string")
          .filter((cp) => branches.some((branch) => branch.id === cp.branchId))
          .map((cp, index) => ({
            id: cp.id,
            title: typeof cp.title === "string" && cp.title.trim() ? cp.title.trim() : `Checkpoint ${index + 1}`,
            branchId: cp.branchId,
            createdAt: typeof cp.createdAt === "string" ? cp.createdAt : now,
            messageCount: Number.isFinite(cp.messageCount) ? cp.messageCount : 0,
            state: cp.state && typeof cp.state === "object" ? clonePlain(cp.state) : clonePlain(fallback),
          }))
      : [];
    return {
      activeBranchId: branches.some((branch) => branch.id === rawBranching.activeBranchId) ? rawBranching.activeBranchId : branches[0].id,
      selectedCheckpointId: checkpoints.some((cp) => cp.id === rawBranching.selectedCheckpointId) ? rawBranching.selectedCheckpointId : null,
      branches,
      checkpoints,
    };
  }

  static getActiveBranch(chat) {
    if (!chat) return null;
    chat.branching = this.normalizeBranching(chat.branching, chat.state || {});
    return chat.branching.branches.find((branch) => branch.id === chat.branching.activeBranchId) || chat.branching.branches[0] || null;
  }
}

export { BranchWorkspace };
