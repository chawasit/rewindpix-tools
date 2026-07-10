import copy
import importlib.util
from pathlib import Path
import re
import sys
import unittest
from urllib.parse import quote, urlencode
import xml.etree.ElementTree as ET


SERVER_PATH = Path(__file__).resolve().parents[1] / "dev-server.py"
SPEC = importlib.util.spec_from_file_location("rewindpix_dev_server", SERVER_PATH)
if SPEC is None or SPEC.loader is None:
    raise ImportError(f"Could not load {SERVER_PATH}")
DEV_SERVER = importlib.util.module_from_spec(SPEC)
ORIGINAL_ARGV = sys.argv
try:
    sys.argv = [str(SERVER_PATH)]
    SPEC.loader.exec_module(DEV_SERVER)
finally:
    sys.argv = ORIGINAL_ARGV

mock_response = DEV_SERVER.mock_response
mock_upload = DEV_SERVER.mock_upload
STATE = DEV_SERVER.STATE
PRISTINE_STATE = copy.deepcopy(STATE)


class MockCameraTest(unittest.TestCase):
    def setUp(self):
        STATE.clear()
        STATE.update(copy.deepcopy(PRISTINE_STATE))

    def tearDown(self):
        STATE.clear()
        STATE.update(copy.deepcopy(PRISTINE_STATE))

    def response_xml(self, command, **parameters):
        query = urlencode({"custom": 1, "cmd": command, **parameters})
        content_type, body = mock_response(f"/?{query}")
        self.assertEqual("text/xml", content_type)
        return ET.fromstring(body.decode("utf-8"))

    def listed_files(self):
        return self.response_xml(3015).findall("./ALLFile/File")

    def test_read_endpoints_expose_camera_identity_status_and_slots(self):
        self.assertEqual("V1.1.3", self.response_xml(3012).findtext("String"))
        self.assertEqual("PS135", self.response_xml(8018).findtext("String"))
        self.assertIsNotNone(self.response_xml(1003).find("Value"))

        status = self.response_xml(3014)
        self.assertEqual(["8004", "8005"], [node.text for node in status.findall("Cmd")])
        self.assertEqual(["99", "2"], [node.text for node in status.findall("Status")])

        slots = self.response_xml(8003)
        self.assertEqual("GLVIVID", slots.findtext("FILM_FILTER_C1"))
        self.assertEqual("GLEXP", slots.findtext("FILM_FILTER_C2"))
        self.assertEqual("BWHC", slots.findtext("FILM_FILTER_C3"))

    def test_seeded_file_listing_is_complete_and_well_formed(self):
        files = self.listed_files()
        self.assertEqual(7, len(files))
        self.assertEqual(2, sum("\\._FILM\\" in file.findtext("FPATH", "") for file in files))

        for file in files:
            name = file.findtext("NAME")
            path = file.findtext("FPATH")
            self.assertRegex(name or "", r"\.JPG$")
            self.assertRegex(path or "", rf"^A:\\DCIM\\[^\\]+\\{re.escape(name or '')}$")
            self.assertRegex(file.findtext("SIZE", ""), r"^[1-9]\d*$")
            self.assertRegex(file.findtext("TIMECODE", ""), r"^\d+$")
            self.assertRegex(file.findtext("TIME", ""), r"^\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2}$")

    def test_roll_write_is_reflected_by_status_read(self):
        self.assertEqual("0", self.response_xml(8004, par=24).findtext("Status"))
        status = self.response_xml(3014)
        self.assertEqual(["8004", "8005"], [node.text for node in status.findall("Cmd")])
        self.assertEqual(["24", "2"], [node.text for node in status.findall("Status")])

    def test_slot_name_write_is_reflected_by_slot_read(self):
        self.assertEqual("0", self.response_xml(8002, str="FILMA:FILMB:FILMC").findtext("Status"))
        slots = self.response_xml(8003)
        self.assertEqual(
            ["FILMA", "FILMB", "FILMC"],
            [slots.findtext(f"FILM_FILTER_C{index}") for index in range(1, 4)],
        )

    def test_film_parameter_write_is_reflected_by_matching_read(self):
        self.assertEqual("0", self.response_xml(8012, str="1:2:3:4:5:6:7").findtext("Status"))
        params = self.response_xml(8013)
        self.assertEqual(
            ["1", "2", "3", "4", "5", "6", "7"],
            [params.findtext(field) for field in DEV_SERVER.FIELDS],
        )

    def test_clock_writes_accept_time_and_change_listing_date(self):
        self.assertEqual("0", self.response_xml(3005, str="2020-02-03").findtext("Status"))
        self.assertTrue(
            all(file.findtext("TIME", "").startswith("2020/02/03 ") for file in self.listed_files())
        )
        self.assertEqual("0", self.response_xml(3006, str="09:08:07").findtext("Status"))

    def test_delete_removes_only_the_named_folder_entry_not_its_twin(self):
        original_count = len(self.listed_files())
        target = r"A:\DCIM\Original_Film\DCIM07102026GLVIVID_0003.JPG"
        self.assertEqual("0", self.response_xml(4003, str=target).findtext("Status"))

        files = self.listed_files()
        self.assertEqual(original_count - 1, len(files))
        paths = [file.findtext("FPATH") for file in files]
        self.assertNotIn(target, paths)
        self.assertIn(r"A:\DCIM\._FILM\DCIM07102026GLVIVID_0003.JPG", paths)

    def test_reset_restores_slot_labels_and_clears_film_parameters(self):
        self.response_xml(8002, str="FILMA:FILMB:FILMC")
        self.response_xml(8012, str="1:2:3:4:5:6:7")
        self.assertEqual("0", self.response_xml(3011).findtext("Status"))

        slots = self.response_xml(8003)
        self.assertEqual(
            ["C1", "C2", "C3"],
            [slots.findtext(f"FILM_FILTER_C{index}") for index in range(1, 4)],
        )
        self.assertEqual(["-255"] * 7, [node.text for node in self.response_xml(8013)])

    def test_multipart_upload_adds_a_developed_photo(self):
        original_count = len(self.listed_files())
        body = (
            b"--boundary\r\n"
            b'Content-Disposition: form-data; name="file"; filename="dev_x.JPG"\r\n'
            b"Content-Type: image/jpeg\r\n\r\n"
            b"jpeg bytes\r\n--boundary--\r\n"
        )
        self.assertEqual(b"ok", mock_upload("/DCIM/Developed_Photos", body))

        files = self.listed_files()
        self.assertEqual(original_count + 1, len(files))
        matches = [file for file in files if file.findtext("NAME") == "dev_x.JPG"]
        self.assertEqual(1, len(matches))
        self.assertEqual(r"A:\DCIM\Developed_Photos\dev_x.JPG", matches[0].findtext("FPATH"))

    def test_unknown_command_returns_success_acknowledgement(self):
        root = self.response_xml(3001)
        self.assertEqual("Function", root.tag)
        self.assertEqual("0", root.findtext("Status"))

    def test_url_encoded_file_path_deletes_file_with_spaces(self):
        STATE["files"].append(["Folder With Space", "photo one.JPG", 123, 1700])
        target = r"A:\DCIM\Folder With Space\photo one.JPG"
        encoded_target = quote(target, safe="")
        content_type, body = mock_response(f"/?custom=1&cmd=4003&str={encoded_target}")
        self.assertEqual("text/xml", content_type)
        self.assertEqual("0", ET.fromstring(body.decode("utf-8")).findtext("Status"))
        self.assertNotIn(target, [file.findtext("FPATH") for file in self.listed_files()])


if __name__ == "__main__":
    unittest.main()
