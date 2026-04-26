from app.services.normalizer import detect_input_type

def test_detect_email():
    assert detect_input_type("person@example.com") == "email"

def test_detect_domain():
    assert detect_input_type("example.com") == "domain"

def test_detect_image():
    assert detect_input_type("photo.jpg") == "image"

def test_detect_username():
    assert detect_input_type("example_user") == "username"
