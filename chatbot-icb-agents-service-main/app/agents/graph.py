import logging
import time
from typing import TypedDict
from langgraph.graph import StateGraph, END
from app.agents.agent_0_classifier import classify_and_retrieve
from app.agents.agent_1_responder import respond
from app.agents.agent_2_reinforcer import reinforce

logger = logging.getLogger("icb.ai")


class AgentState(TypedDict):
    question: str
    uid: str | None
    weak_points: str
    rag_context: str
    videos: list
    tema: str | None
    image_base64: str | None
    answer: str
    reinforcement: dict


def node_classifier(state: AgentState) -> dict:
    t0 = time.time()
    result = classify_and_retrieve(state["question"], state.get("uid"))
    logger.info(f"node_classifier: {time.time()-t0:.2f}s")
    return {
        "rag_context": result["rag_context"],
        "videos": result["videos"],
        "tema": result["tema"],
    }


def node_responder(state: AgentState) -> dict:
    t0 = time.time()
    answer = respond(
        question=state["question"],
        rag_context=state["rag_context"],
        weak_points=state["weak_points"],
        image_base64=state.get("image_base64"),
    )
    logger.info(f"node_responder: {time.time()-t0:.2f}s → {len(answer)} chars")
    return {"answer": answer}


def node_reinforcer(state: AgentState) -> dict:
    t0 = time.time()
    reinforcement = reinforce(
        question=state["question"],
        answer=state["answer"],
        rag_context=state["rag_context"],
        tema=state.get("tema"),
    )
    logger.info(f"node_reinforcer: {time.time()-t0:.2f}s")
    return {"reinforcement": reinforcement}


def _route_after_responder(state: AgentState) -> str:
    """Si la pregunta es matemática (tema != None), pasa al reinforcer.
    Si no, termina directamente — ahorra 2-4s en preguntas no matemáticas."""
    return "reinforcer" if state.get("tema") else END


def build_graph():
    graph = StateGraph(AgentState)

    graph.add_node("classifier", node_classifier)
    graph.add_node("responder", node_responder)
    graph.add_node("reinforcer", node_reinforcer)

    graph.set_entry_point("classifier")
    graph.add_edge("classifier", "responder")

    # El reinforcer solo corre si la pregunta es matemática
    graph.add_conditional_edges(
        "responder",
        _route_after_responder,
        {"reinforcer": "reinforcer", END: END},
    )
    graph.add_edge("reinforcer", END)

    return graph.compile()


agent_graph = build_graph()
