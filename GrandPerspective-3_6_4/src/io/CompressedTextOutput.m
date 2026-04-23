/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import <zlib.h>

#import "CompressedTextOutput.h"

@implementation CompressedTextOutput

- (instancetype) initWithPath:(NSURL *)path {
  if (self = [super initWithPath: path]) {
    compressedDataBuffer = malloc(TEXT_OUTPUT_BUFFER_SIZE);

    outStream.zalloc = Z_NULL;
    outStream.zfree = Z_NULL;
    int result = deflateInit2(&outStream,
                              Z_DEFAULT_COMPRESSION,
                              Z_DEFLATED,
                              15 + 16, // Default window size with GZIP format enabled
                              9,
                              Z_DEFAULT_STRATEGY);
    NSAssert(result == Z_OK, @"deflateInit2 failed");
  }

  return self;
}

- (void) dealloc {
  free(compressedDataBuffer);

  deflateEnd(&outStream);

  [super dealloc];
}

- (BOOL) flush {
  int flush = (dataBufferPos < TEXT_OUTPUT_BUFFER_SIZE) ? Z_FINISH : Z_NO_FLUSH;

  outStream.next_in = dataBuffer;
  outStream.avail_in = (unsigned int)dataBufferPos;

  int result;
  do {
    outStream.next_out = compressedDataBuffer;
    outStream.avail_out = (unsigned int)TEXT_OUTPUT_BUFFER_SIZE;

    result = deflate(&outStream, flush);
    if (result == Z_STREAM_ERROR || result == Z_BUF_ERROR) {
      NSLog(@"Error invoking deflate: %d", result);
      return NO;
    }

    NSUInteger  numProduced = TEXT_OUTPUT_BUFFER_SIZE - outStream.avail_out;

    if (numProduced > 0) {
      NSUInteger  numWritten = fwrite(compressedDataBuffer, 1, numProduced, file);
      if (numWritten != numProduced) {
        NSLog(@"Failed to write compressed text data: %lu bytes written out of %lu.",
              (unsigned long)numWritten, (unsigned long)numProduced);
        return NO;
      }
    }
  } while (outStream.avail_in > 0 || (flush == Z_FINISH && result != Z_STREAM_END));

  dataBufferPos = 0;
  return YES;
}

@end // @implementation CompressedTextOutput
