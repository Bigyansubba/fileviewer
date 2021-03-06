/*
 Copyright (c) 2016 Dmitry Brant.
 http://dmitrybrant.com

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

function parseFormat(reader)
{
	var results = new ResultNode("ID3 structure");
	try {
		var stream = new DataStream(reader);
        var frames = id3v2ReadContainer(stream);

        results.add("ID3 version", reader.byteAt(3));

        for (var i = 0; i < frames.length; i++) {
            var node = results.add(frames[i].frameID, frames[i].frameString);

            if (frames[i].frameID == "APIC" || frames[i].frameID == "PIC") {

                if (reader.byteAt(frames[i].apicAbsoluteLocation) == 0x89 && reader.byteAt(frames[i].apicAbsoluteLocation + 1) == 0x50) {
                    node.addResult(parsePngStructure(reader, frames[i].apicAbsoluteLocation));
                } else if (reader.byteAt(frames[i].apicAbsoluteLocation) == 0xFF && reader.byteAt(frames[i].apicAbsoluteLocation + 1) == 0xD8) {
                    node.addResult(parseJpgStructure(reader, frames[i].apicAbsoluteLocation));
                }

                var thumbString = "data:image/png;base64," + base64FromArrayBuffer(reader.dataView.buffer, frames[i].apicAbsoluteLocation, frames[i].apicSize);
                var thumbHtml = "<img class='previewImage' src='" + thumbString + "' />";
                node.add("Image", thumbHtml);
                stream.reader.onGetPreviewImage(thumbString);
            }
        }

	} catch(e) {
		console.log("Error while reading ID3: " + e);
	}
	return results;
}

function mp3ReadSyncSafeInt(stream, length) {
    var sum = 0;
    for (var i = 0; i < length; i++) {
        sum <<= 7;
        sum |= (stream.readByte() & 0x7F);
    }
    return sum;
}

function id3ReadString(stream, length) {
    var retStr = "";
    var strType = stream.readByte();
    if (strType == 0) {
        retStr = stream.readAsciiString(length - 1); // ISO-8859-1
    } else if (strType == 1) {
        retStr = stream.readUtf16LeString(length - 1, true);
    } else if (strType == 2) {
        retStr = stream.readUtf16BeString(length - 1, true); // UTF-16BE
    } else if (strType == 3) {
        retStr = stream.readAsciiString(length - 1); // UTF-8
    } else {
        // Just read the string without a type. Seems to be the case for POPM
        stream.seek(-1, 1);
        retStr = stream.readAsciiString(length);
    }
    retStr = retStr.replace("\0", "");
    return retStr;
}

var id3AsciiWorthyTags = [ "TIT1", "TIT2", "TPE1", "TPE2", "TALB", "TCON", "TPOS", "WXXX", "TYER", "COMM", "TENC", /*"POPM",*/ "TXXX", "TCMP", "TSSE", "TLEN", "TLAN", "TPUB", "TDAT",
                           "TT2", "TP1", "TP2", "TT1", "TCM", "TAL", "TRK", "TPA", "TYE", "TCO", "COM", "TEN" ];
var id3WikiableTags = [ "TALB", "TPE1", "TPE2", "TP1", "TP2", "TAL" ];
var id3HeaderSize = 10;
var id3FrameHeaderSize = 10;

function id3v2ReadContainer(stream) {
    var frames = [];
    if (stream.readAsciiString(3) != "ID3") {
        return frames;
    }
    var id3Version = stream.readByte();
    var id3Revision = stream.readByte();
    var id3Flags = stream.readByte();
    var id3Size = mp3ReadSyncSafeInt(stream, 4);

    //do we have an extended header?
    if ((id3Flags & 0x40) != 0) {
        var extHeaderSize = id3Version >= 4 ? mp3ReadSyncSafeInt(stream, 4) : stream.readUIntBe();
        if (extHeaderSize < 0 || extHeaderSize > 10000000) {
            return frames;
        }
        stream.skip(extHeaderSize);
    }

    //cycle through frames...
    var currentLength = 0;
    while (currentLength < id3Size) {
        var frame = new id3v2Frame(stream, id3Version);

        if (frame.frameSize == 0) {
            //padding has begun
            break;
        }

        frames.push(frame);
        currentLength += (frame.frameSize + id3FrameHeaderSize);
    }
    return frames;
}

var id3v2Frame = function(stream, id3Version) {
    this.stream = stream;
    this.frameAbsoluteLocation = stream.position;

    this.apicMimeType = "";
    this.apicDescription = "";
    this.apicAbsoluteLocation = 0;
    this.apicSize = 0;

    this.frameID = stream.readAsciiString(id3Version < 3 ? 3 : 4);
    this.frameSize = id3Version >= 4 ? mp3ReadSyncSafeInt(stream, 4) : (id3Version == 3 ? stream.readUIntBe() : id3v2read3byteIntBe(stream));
    if (id3Version > 2) {
        this.frameFlags = stream.readUShortBe();
    }
    this.frameString = "";

    this.processAPIC = function (stream) {
        var initialPos = stream.position;

        var textEncoding = stream.readByte();
        if (id3Version > 2) {
            stream.skip(3);
        }

        var textEnd = 0;
        var textByte;
        this.apicMimeType = "";
        while (textEnd < 10000) {
            textByte = stream.readByte();
            if (textByte == 0) {
                break;
            }
            this.apicMimeType += String.fromCharCode(textByte);
            textEnd++;
        }

        if (id3Version > 2) {
            var pictureType = stream.readByte();
        }
        textEnd = 0;
        this.apicDescription = "";
        while (textEnd < 10000) {
            textByte = stream.readByte();
            if (textByte == 0) {
                break;
            }
            this.apicDescription += String.fromCharCode(textByte);
            textEnd++;
        }

        this.apicAbsoluteLocation = stream.position;
        this.apicSize = this.frameSize - (this.apicAbsoluteLocation - initialPos);
        stream.seek(this.apicSize, 1);
    };

    if (this.frameID == "APIC" || this.frameID == "PIC") {
        this.processAPIC(stream);
    } else {
        if (id3AsciiWorthyTags.indexOf(this.frameID) >= 0 && this.frameSize < 4096) {
            this.frameString = id3ReadString(stream, this.frameSize);
            if (id3WikiableTags.indexOf(this.frameID) >= 0) {
                this.frameString = wikiLinkifyString(this.frameString);
            }
        } else {
            stream.skip(this.frameSize);
        }
    }
};

function id3v2read3byteIntBe(stream) {
    var ret = stream.readByte();
    ret <<= 8;
    ret |= stream.readByte();
    ret <<= 8;
    ret |= stream.readByte();
    return ret;
}