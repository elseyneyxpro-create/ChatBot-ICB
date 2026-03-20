from typing import TypedDict
from langgraph.graph import StateGraph, END
from app.agents.agent_0_classifier import classify_and_retrieve
from app.agents.agent_1_responder import respond
from app.agents.agent_2_reinforcer import reinforce


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
    result = classify_and_retrieve(state["question"], state.get("uid"))
    return {
        "rag_context": result["rag_context"],
        "videos": result["videos"],
        "tema": result["tema"],
    }


def node_responder(state: AgentState) -> dict:
    answer = respond(
        question=state["question"],
        rag_context=state["rag_context"],
        weak_points=state["weak_points"],
        image_base64=state.get("image_base64"),
    )
    return {"answer": answer}


def node_reinforcer(state: AgentState) -> dict:
    reinforcement = reinforce(
        question=state["question"],
        rag_context=state["rag_context"],
    )
    return {"reinforcement": reinforcement}


def build_graph():
    graph = StateGraph(AgentState)

    graph.add_node("classifier", node_classifier)
    graph.add_node("responder", node_responder)
    graph.add_node("reinforcer", node_reinforcer)

    # Flujo: classifier → responder y reinforcer en PARALELO → END
    graph.set_entry_point("classifier")
    graph.add_edge("classifier", "responder")
    graph.add_edge("classifier", "reinforcer")
    graph.add_edge("responder", END)
    graph.add_edge("reinforcer", END)

    return graph.compile()


agent_graph = build_graph()
