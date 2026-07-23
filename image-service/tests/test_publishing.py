"""Testes do GraphApiPublisher (container Story vs Feed). Sem rede — requests mockado."""
import json
from unittest.mock import MagicMock, patch

from app.publishing.graph_api import GraphApiPublisher


def _pub() -> GraphApiPublisher:
    return GraphApiPublisher(ig_user_id="123", access_token="tok")


def _fake_responses(create_id="cont1", publish_id="media1"):
    """Sequência: POST /media -> GET status -> POST /media_publish."""
    create = MagicMock(ok=True)
    create.json.return_value = {"id": create_id}
    status = MagicMock(ok=True)
    status.json.return_value = {"status_code": "FINISHED"}
    publish = MagicMock(ok=True)
    publish.json.return_value = {"id": publish_id}
    return create, status, publish


def test_story_container_sends_media_type_stories_and_no_caption():
    create, status, publish = _fake_responses()
    with patch("app.publishing.graph_api.requests.post", side_effect=[create, publish]) as post, patch(
        "app.publishing.graph_api.requests.get", return_value=status
    ):
        mid = _pub().publish("http://img", media_type="STORIES", caption="oi")

    assert mid == "media1"
    create_data = post.call_args_list[0].kwargs["data"]
    assert create_data["media_type"] == "STORIES"
    assert create_data["image_url"] == "http://img"
    assert "caption" not in create_data  # story ignora legenda


def test_feed_container_omits_media_type_and_sends_caption():
    create, status, publish = _fake_responses()
    with patch("app.publishing.graph_api.requests.post", side_effect=[create, publish]) as post, patch(
        "app.publishing.graph_api.requests.get", return_value=status
    ):
        mid = _pub().publish_feed("http://img", caption="minha legenda #foto")

    assert mid == "media1"
    create_data = post.call_args_list[0].kwargs["data"]
    assert "media_type" not in create_data  # IMAGE = default, não enviado
    assert create_data["caption"] == "minha legenda #foto"


def test_status_poll_uses_bearer_header_not_query():
    create, status, publish = _fake_responses()
    with patch("app.publishing.graph_api.requests.post", side_effect=[create, publish]), patch(
        "app.publishing.graph_api.requests.get", return_value=status
    ) as get:
        _pub().publish("http://img", media_type="STORIES")

    # Token nunca na query (vaza em logs de exceção do requests); só no header.
    assert "access_token" not in get.call_args.kwargs.get("params", {})
    assert get.call_args.kwargs["headers"]["Authorization"] == "Bearer tok"


def test_feed_sends_user_tags_as_json():
    create, status, publish = _fake_responses()
    tags = [{"username": "fulano", "x": 0.5, "y": 0.8}]
    with patch("app.publishing.graph_api.requests.post", side_effect=[create, publish]) as post, patch(
        "app.publishing.graph_api.requests.get", return_value=status
    ):
        _pub().publish_feed("http://img", caption="oi", user_tags=tags)

    create_data = post.call_args_list[0].kwargs["data"]
    # A API espera user_tags como string JSON no corpo do form.
    assert json.loads(create_data["user_tags"]) == tags


def test_story_sends_user_tags_mention():
    create, status, publish = _fake_responses()
    tags = [{"username": "fulano", "x": 0.3, "y": 0.4}]
    with patch("app.publishing.graph_api.requests.post", side_effect=[create, publish]) as post, patch(
        "app.publishing.graph_api.requests.get", return_value=status
    ):
        _pub().publish_story("http://img", user_tags=tags)

    create_data = post.call_args_list[0].kwargs["data"]
    assert create_data["media_type"] == "STORIES"
    assert json.loads(create_data["user_tags"]) == tags


def test_no_user_tags_omits_field():
    create, status, publish = _fake_responses()
    with patch("app.publishing.graph_api.requests.post", side_effect=[create, publish]) as post, patch(
        "app.publishing.graph_api.requests.get", return_value=status
    ):
        _pub().publish_feed("http://img", caption="oi")

    assert "user_tags" not in post.call_args_list[0].kwargs["data"]


def test_publish_story_wrapper_keeps_behavior():
    create, status, publish = _fake_responses(publish_id="m2")
    with patch("app.publishing.graph_api.requests.post", side_effect=[create, publish]) as post, patch(
        "app.publishing.graph_api.requests.get", return_value=status
    ):
        mid = _pub().publish_story("http://img")

    assert mid == "m2"
    assert post.call_args_list[0].kwargs["data"]["media_type"] == "STORIES"
