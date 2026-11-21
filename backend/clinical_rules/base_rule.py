from abc import ABC, abstractmethod
from ..models.clinical import ClinicalFinding, ClinicalContext

class BaseRule(ABC):
    @abstractmethod
    def evaluate(self, context: ClinicalContext) -> ClinicalFinding:
        pass
