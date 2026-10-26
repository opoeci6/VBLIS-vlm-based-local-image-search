"""Score model for search results.

Collections use cosine distance, so cos = 1 - distance. What the user sees as "score" depends on the query:
- text on SigLIP models: the model's own match curve sigmoid(scale * cos + bias) with a "search prior"
  added to the logit (see SEARCH_PRIOR_LOGIT);
- text on models without a logit_bias (CLIP): the plain cosine similarity with a fixed floor;
- query by image: the plain cosine similarity.
The values were chosen with the user in round S (stage S1) from measurements on their library.
"""
import math
from typing import NamedTuple, Optional

# Added to the SigLIP logit, i.e. the match odds times e^6 (about 400). The logit_bias was learned on training
# batches where nearly every pair is a negative, so the raw probability that a short query describes an image
# stays at 0.1-5% even for clearly correct hits. With this prior, correct top hits read about 60-100% and
# the best hits of unrelated queries about 2-30%.
SEARCH_PRIOR_LOGIT = 6.0
DEFAULT_TEXT_MIN_SCORE = 0.10
DEFAULT_IMAGE_MIN_SIMILARITY = 0.70
# CLIP has no calibrated bias; its good text-image matches reach about 0.25-0.31, junk mostly stays below this
CLIP_TEXT_MIN_SIMILARITY = 0.22


class ScoreParams(NamedTuple):
    scale: float  # exp(logit_scale)
    bias: float   # logit_bias


def read_score_params(model) -> Optional[ScoreParams]:
    """Calibration of a model, or None when it has no logit_bias (e.g. CLIP) or logit_scale."""
    if model is None:
        return None
    logit_scale = getattr(model, "logit_scale", None)
    logit_bias = getattr(model, "logit_bias", None)
    if logit_scale is None or logit_bias is None:
        return None
    scale = math.exp(float(logit_scale.detach().float().reshape(-1)[0].item()))
    bias = float(logit_bias.detach().float().reshape(-1)[0].item())
    return ScoreParams(scale=scale, bias=bias)


def _sigmoid(x: float) -> float:
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    e = math.exp(x)
    return e / (1.0 + e)


class Scorer(NamedTuple):
    kind: str  # "match" (calibrated probability) or "similarity" (cosine)
    min_score: float
    params: Optional[ScoreParams]

    def score(self, cos: float) -> float:
        """Monotone non-decreasing in cos."""
        if self.params is None:
            return max(cos, 0.0)
        x = self.params.scale * cos + self.params.bias + SEARCH_PRIOR_LOGIT
        # clamped so math.exp can never overflow
        return _sigmoid(max(min(x, 700.0), -700.0))


def make_scorer(query_kind: str, params: Optional[ScoreParams], min_score: float) -> Scorer:
    if query_kind == "text":
        if params is not None:
            return Scorer("match", min_score, params)
        return Scorer("similarity", CLIP_TEXT_MIN_SIMILARITY, None)
    if query_kind == "image":
        return Scorer("similarity", min_score, None)
    raise ValueError(f"Unknown query kind: {query_kind!r}")
